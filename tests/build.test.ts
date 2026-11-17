import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { planAgents } from "../bay/build.ts";
import { skillNameOf, skillToolsOf } from "../bay/skill-tools.ts";
import { isRecord } from "../bay/json.ts";
import { streamTerminal } from "../bay/terminal.ts";
import { openKernel } from "./kernel-fixture.ts";
import { makeProject } from "./project-fixture.ts";

test("planAgents gives one agent per mode and skill, at the highest tier asked, with the union of effects", async () => {
  const project = await makeProject();
  const manifestFile = "components/modes/writer/mode.yaml";
  const manifest: unknown = parse(await project.read(manifestFile));
  assert.ok(isRecord(manifest) && isRecord(manifest.actions));
  const redraft = {
    description: "When the owner wants a note drafted again.",
    input: "schemas/compose-input.json",
    output: "schemas/draft-output.json",
    effects: ["read", "spend"],
    run: [{ skill: "skills/draft/", tier: "deep" }],
  };
  const actions = { ...manifest.actions, redraft };
  await project.write(manifestFile, stringify({ ...manifest, actions }));
  const kernel = await openKernel(project);
  const planned = await planAgents(kernel.system);
  assert.ok(planned.ok, planned.ok ? "" : JSON.stringify(planned.problems));
  assert.equal(planned.value.length, 1);
  const [agent] = planned.value;
  assert.ok(agent);
  assert.equal(agent.agent, "agentbay-writer-draft");
  assert.equal(agent.skill, "draft");
  assert.equal(agent.tier, "deep");
  assert.equal(agent.description, "Writes a short note that greets the person named in the input.");
  assert.deepEqual([...agent.effects].sort(), ["read", "spend", "write"]);
  assert.deepEqual(agent.grants.writePaths, [`${project.root}/out/notes`]);
  kernel.close();
  await project.remove();
});

test("planAgents reports a skill whose front matter cannot be read", async () => {
  const project = await makeProject();
  await project.write("components/modes/writer/skills/draft/SKILL.md", "no front matter\n");
  const kernel = await openKernel(project);
  const planned = await planAgents(kernel.system);
  assert.ok(!planned.ok);
  assert.match(planned.problems[0]?.message ?? "", /has no front matter/);
  kernel.close();
  await project.remove();
});

test("the tools a skill's Tools section lists map to kernel tools; secrets, http and events give none", () => {
  assert.deepEqual(skillToolsOf(["files", "secrets", "http"]), {
    kernelTools: ["files_read", "files_list", "files_write", "submit"],
    actions: [],
  });
  assert.deepEqual(skillToolsOf(["items-store.get", "db"]), {
    kernelTools: ["db_query", "call_action", "submit"],
    actions: ["items-store.get"],
  });
  assert.deepEqual(skillToolsOf([]), { kernelTools: ["submit"], actions: [] });
  assert.equal(skillNameOf("skills/draft/"), "draft");
});

test("the terminal reads a line and all of stdin", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = "";
  output.on("data", (chunk: Buffer) => {
    shown += chunk.toString();
  });
  const terminal = streamTerminal({ input, output });
  assert.equal(terminal.isInteractive(), false);
  const answer = terminal.ask("Type yes: ");
  input.write("yes\n");
  assert.equal(await answer, "yes");
  assert.equal(shown, "Type yes: ");
  const all = terminal.readAll();
  input.end('{"text":"x"}');
  assert.equal(await all, '{"text":"x"}');
});

const dreamSkill = [
  "---",
  "name: dream",
  "description: Dreams; a skill of a kit mode that no project lists.",
  "metadata:",
  "  output: schemas/anything.json",
  "---",
  "",
  ...["Input", "Output", "Definition of done", "Instructions", "Tools", "Resources", "Rules and constraints"].flatMap(
    (section) => [`## ${section}`, "", "- Nothing.", ""],
  ),
].join("\n");

function sleepingMode(name: string, step: Readonly<Record<string, string>>): string {
  const action = {
    description: "When a test needs an action of a kit mode that no project lists.",
    input: "schemas/anything.json",
    output: "schemas/anything.json",
    effects: ["read"],
    run: [step],
  };
  return stringify({ name, version: "1.0.0", description: "A kit mode no project lists.", actions: { rest: action } });
}

async function kitOfSleepingModes(): Promise<string> {
  const kit = await realpath(await mkdtemp(join(tmpdir(), "agentbay-kit-")));
  const files = {
    "components/modes/sleeper/mode.yaml": sleepingMode("sleeper", { skill: "skills/dream", tier: "fast" }),
    "components/modes/sleeper/skills/dream/SKILL.md": dreamSkill,
    "components/modes/sleeper/schemas/anything.json": '{ "type": "object" }\n',
    "components/base/napper/mode.yaml": sleepingMode("napper", { script: "scripts/nap.ts" }),
    "components/base/napper/schemas/anything.json": '{ "type": "object" }\n',
    "components/base/napper/scripts/nap.ts": "",
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(kit, path)), { recursive: true });
    await writeFile(join(kit, path), text, "utf8");
  }
  return kit;
}

test("planAgents plans agents only for the active modes, each pointing at its skill file by absolute path", async () => {
  const project = await makeProject();
  const kit = await kitOfSleepingModes();
  const kernel = await openKernel(project, { kit });
  const active = await planAgents(kernel.system);
  assert.ok(active.ok, active.ok ? "" : JSON.stringify(active.problems));
  assert.deepEqual(
    active.value.map((agent) => agent.skillFile),
    [`${project.root}/components/modes/writer/skills/draft/SKILL.md`],
  );
  assert.deepEqual(Array.from(kernel.system.inactive).sort(), ["napper", "sleeper"]);
  kernel.close();
  await project.remove();
  await rm(kit, { recursive: true, force: true });
});
