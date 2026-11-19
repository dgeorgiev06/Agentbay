import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fieldOf, textField, toJson } from "../bay/json.ts";
import { bay, listOf } from "./cli-fixture.ts";
import { kit, makeProject, skillText, type Project } from "./project-fixture.ts";

async function withProject(body: (project: Project) => Promise<void>, ownKernel = false): Promise<void> {
  const project = await makeProject({ ownKernel });
  try {
    await body(project);
  } finally {
    await project.remove();
  }
}

test("check prints the summary and exits 0 on a clean project, 1 with every error listed", async () => {
  await withProject(async (project) => {
    const asKit = { kit: project.root };
    const clean = await bay(["check", "--project", project.root], asKit);
    assert.equal(clean.exitCode, 0, clean.output);
    assert.equal(clean.output, "bay check: 0 errors, 0 warnings.");
    await project.write("components/modes/writer/skills/draft/SKILL.md", skillText.replace("## Tools", "## Tooling"));
    const broken = await bay(["check", "--project", project.root, "--json"], asKit);
    assert.equal(broken.exitCode, 1);
    const json = toJson(broken.json);
    assert.equal(fieldOf(json, "ok"), false);
    assert.ok(JSON.stringify(fieldOf(json, "findings")).includes('has no \\"## Tools\\" section'));
  }, true);
});

test("check counts warnings without failing", async () => {
  await withProject(async (project) => {
    await project.write(
      "framework/limits.yaml",
      "kernel_lines: 0\nadapter_lines: 0\nconcepts: 0\ncli_commands: 0\n" + "top_level_folders: 0\n",
    );
    const ran = await bay(["check", "--project", project.root, "--json"], { kit: project.root });
    assert.equal(ran.exitCode, 0, JSON.stringify(ran.json));
    assert.ok(Number(fieldOf(toJson(ran.json), "warnings")) > 0);
  }, true);
});

test("new writes from the K2 templates and checks the options each kind needs", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    const asKit = { kit: project.root };
    const skill = await bay(["new", "skill", "summarize", "--mode", "writer", ...root], asKit);
    assert.equal(skill.exitCode, 0, skill.output);
    assert.equal(skill.output, "+ components/modes/writer/skills/summarize/SKILL.md");
    assert.match(await project.read("components/modes/writer/skills/summarize/SKILL.md"), /## Rules and constraints/);
    const mode = await bay(["new", "mode", "keeper", "--tier", "base", ...root, "--json"], asKit);
    assert.ok(JSON.stringify(mode.json).includes("components/base/keeper/mode.yaml"));
    const cases: readonly (readonly [readonly string[], RegExp])[] = [
      [["new", "action", "tidy"], /This kind needs --mode <mode>\./],
      [["new", "feature", "x"], /There is no kind feature; the kinds are mode, action, skill, workflow, interface\./],
      [["new", "mode", "x", "--tier", "top"], /--tier is base or modes\./],
    ];
    for (const [argv, message] of cases) {
      const ran = await bay([...argv, ...root], asKit);
      assert.equal(ran.exitCode, 2, argv.join(" "));
      assert.match(ran.output, message);
    }
    const again = await bay(["new", "mode", "keeper", "--tier", "base", ...root], asKit);
    assert.equal(again.exitCode, 1);
  }, true);
});

test("config prints every setting of the config schema and of each mode's settings schema with its value", async () => {
  await withProject(async (project) => {
    const ran = await bay(["config", "--project", project.root]);
    assert.equal(ran.exitCode, 0, ran.output);
    for (const expected of [
      "bindings: object (Which mode serves each interface, as interface name: binding; " +
        "one major per project in 5.0.0.)" +
        '\n  current: {"greeting-source":"greeter"}',
      'adapter: string (The adapter that runs skill steps.)\n  current: "fake"',
      "budget.usd: number (The most US dollars the run may spend.)\n  current: not set",
      'approvals.from: list of one of "terminal", "chat" (The channels approve accepts; without this setting only terminal.)\n  current: not set',
      'settings.writer.signature: string (The words that end every note.)\n  current: "Yours, the writer"',
    ]) {
      assert.ok(ran.output.includes(expected), `missing:\n${expected}\nin:\n${ran.output}`);
    }
    assert.ok(ran.output.endsWith("bindings in use:\n  greeting-source: greeter serves writer"), ran.output);
    assert.ok(!/^settings:/m.test(ran.output));
    const json = await bay(["config", "--project", project.root, "--json"]);
    const settings = listOf(fieldOf(toJson(json.json), "settings"));
    const names = settings.map((setting) => textField(setting, "name"));
    assert.deepEqual(names, [
      "bindings",
      "adapter",
      "modes",
      "budget.items",
      "budget.usd",
      "budget.tokens",
      "budget.minutes",
      "tiers.fast.model",
      "tiers.fast.effort",
      "tiers.balanced.model",
      "tiers.balanced.effort",
      "tiers.deep.model",
      "tiers.deep.effort",
      "approvals.from",
      "settings.writer.signature",
    ]);
    assert.deepEqual(fieldOf(toJson(json.json), "bindings"), [
      { interfaceName: "greeting-source", requirers: ["writer"], servedBy: "greeter" },
    ]);
  });
});

test("auth and import-v4 are registered and say they are not built yet", async () => {
  const auth = await bay(["auth"]);
  assert.equal(auth.exitCode, 1);
  assert.equal(auth.output, "not built yet (comes with the M2 slice)");
  const imported = await bay(["import-v4", "--json"]);
  assert.equal(imported.exitCode, 1);
  assert.deepEqual(imported.json, { ok: false, message: "not built yet (comes with the M4 slice)" });
});

const fakeAdapter = `
import { writeFile } from "node:fs/promises";
export const adapter = {
  name: "fake",
  build: async (request) => {
    const record = {
      project: request.layout.project,
      kit: request.layout.kit,
      modes: [...request.system.modes.keys()].sort(),
      agents: request.agents,
    };
    await request.files.writeAtomic(request.layout.project + "/.fake/build.json", JSON.stringify(record));
    return { ok: true, value: [".fake/build.json"] };
  },
  clean: async (request) => {
    await writeFile(request.layout.project + "/.fake/cleaned", "yes");
    return { ok: true, value: [".fake/build.json"] };
  },
};
`;

async function withKit(body: (kitFolder: string) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), "agentbay-kit-"));
  await mkdir(join(folder, "adapters", "fake"), { recursive: true });
  await writeFile(join(folder, "adapters", "fake", "adapter.ts"), fakeAdapter);
  await mkdir(join(folder, "adapters", "empty"), { recursive: true });
  await writeFile(join(folder, "adapters", "empty", "adapter.ts"), "export const other = 1;\n");
  try {
    await body(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test("build plans one agent per skill and hands the request to the adapter the config names", async () => {
  await withProject(async (project) => {
    await withKit(async (kitFolder) => {
      const built = await bay(["build", "--project", project.root, "--json"], { kit: kitFolder });
      assert.equal(built.exitCode, 0, JSON.stringify(built.json));
      assert.deepEqual(built.json, { ok: true, paths: [".fake/build.json"] });
      const record = toJson(JSON.parse(await project.read(".fake/build.json")));
      assert.equal(textField(record, "project"), project.root);
      assert.equal(textField(record, "kit"), kitFolder);
      assert.deepEqual(fieldOf(record, "modes"), ["greeter", "writer"]);
      const agents = listOf(fieldOf(record, "agents"));
      assert.equal(agents.length, 1);
      const agent = agents[0] ?? null;
      assert.equal(textField(agent, "agent"), "agentbay-writer-draft");
      assert.equal(textField(agent, "skillFile"), join(project.root, "components/modes/writer/skills/draft/SKILL.md"));
      assert.equal(textField(agent, "tier"), "balanced");
      assert.deepEqual(fieldOf(agent, "kernelTools"), [
        "db_query",
        "files_read",
        "files_list",
        "files_write",
        "call_action",
        "submit",
      ]);
      const cleaned = await bay(["build", "--clean", "--project", project.root], { kit: kitFolder });
      assert.equal(cleaned.exitCode, 0);
      assert.equal(await project.read(".fake/cleaned"), "yes");
    });
  });
});

test("build refuses an adapter that is missing, misnamed or exports no adapter", async () => {
  await withProject(async (project) => {
    await withKit(async (kitFolder) => {
      const cases: readonly (readonly [string, RegExp])[] = [
        ["nowhere", /There is no adapter nowhere/],
        ["../fake", /The adapter name \.\.\/fake is not kebab-case/],
        ["empty", /does not export an adapter value/],
      ];
      for (const [name, message] of cases) {
        const ran = await bay(["build", "--adapter", name, "--project", project.root], { kit: kitFolder });
        assert.equal(ran.exitCode, 1, name);
        assert.match(ran.output, message);
      }
    });
  });
});

test("the real kit is where build looks for adapters by default", async () => {
  await withProject(async (project) => {
    const ran = await bay(["build", "--project", project.root]);
    assert.equal(ran.exitCode, 1);
    assert.ok(ran.output.includes(join(kit, "adapters", "fake", "adapter.ts")));
  });
});
