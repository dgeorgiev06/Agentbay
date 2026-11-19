import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { kit, makeProject, skillText, type Project } from "./project-fixture.ts";

type Ran = { readonly status: number | null; readonly output: string };

const writerFolder = "components/modes/writer";

const agentFiles = {
  fast: ".claude/agents/agentbay-writer-quick.md",
  balanced: ".claude/agents/agentbay-writer-draft.md",
  deep: ".claude/agents/agentbay-writer-careful.md",
} as const;

function ran(project: Project, words: readonly string[]): Ran {
  const result = spawnSync(process.execPath, [project.cli, ...words, "--project", project.root], {
    cwd: project.root,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    input: "",
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function composeWith(skill: string, tier: string): unknown {
  const compose = {
    description: `When the owner wants a note drafted by the ${skill} skill.`,
    input: "schemas/compose-input.json",
    output: "schemas/compose-output.json",
    effects: ["read", "write"],
    run: [
      { script: "scripts/prepare.ts" },
      { skill: `skills/${skill}`, tier, checks: ["scripts/long-enough.ts"] },
      { script: "scripts/finish.ts" },
    ],
  };
  return compose;
}

async function projectWithEveryTier(tiers?: unknown): Promise<Project> {
  const project = await makeProject({ adapter: "claude-code" });
  const mode: unknown = parse(await project.read(`${writerFolder}/mode.yaml`));
  const actions = fieldOf(mode, "actions");
  const withTiers = {
    ...(typeof mode === "object" ? mode : {}),
    actions: {
      ...(typeof actions === "object" ? actions : {}),
      "compose-quickly": composeWith("quick", "fast"),
      "compose-carefully": composeWith("careful", "deep"),
    },
  };
  await project.write(`${writerFolder}/mode.yaml`, stringify(withTiers));
  for (const skill of ["quick", "careful"]) {
    await project.write(`${writerFolder}/skills/${skill}/SKILL.md`, skillText.replace("name: draft", `name: ${skill}`));
  }
  const example = await project.read(`${writerFolder}/tests/compose.example.json`);
  for (const action of ["compose-quickly", "compose-carefully"]) {
    await project.write(`${writerFolder}/tests/${action}.example.json`, example);
  }
  if (tiers !== undefined) {
    await setTiers(project, tiers);
  }
  return project;
}

async function setTiers(project: Project, tiers: unknown): Promise<void> {
  const config: unknown = parse(await project.read("agentbay.config.yaml"));
  await project.write("agentbay.config.yaml", stringify({ ...(typeof config === "object" ? config : {}), tiers }));
}

function frontMatter(text: string): Readonly<Record<string, string>> {
  const [, header = ""] = text.split("---\n");
  const lines = header.trim().split("\n");
  return Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)]));
}

type Written = { readonly model: string; readonly effort: string };

async function writtenFor(project: Project, path: string): Promise<Written> {
  const header = frontMatter(await project.read(path));
  return { model: header["model"] ?? "not written", effort: header["effort"] ?? "not written" };
}

async function builtTiers(project: Project): Promise<Readonly<Record<keyof typeof agentFiles, Written>>> {
  return {
    fast: await writtenFor(project, agentFiles.fast),
    balanced: await writtenFor(project, agentFiles.balanced),
    deep: await writtenFor(project, agentFiles.deep),
  };
}

function digestOf(project: Project, text: string): string {
  const placeless = text.replaceAll(project.root, "<project>").replaceAll(kit, "<kit>");
  return createHash("sha256").update(placeless, "utf8").digest("hex");
}

test("with no tiers set, bay build writes every step agent and the step policy as it did before tiers", async () => {
  const project = await projectWithEveryTier();
  try {
    assert.equal(ran(project, ["build"]).status, 0);
    const digests = await Promise.all(
      [...Object.values(agentFiles), ".agentbay/steps.json"].map(async (path) =>
        digestOf(project, await project.read(path)),
      ),
    );
    assert.deepEqual(digests, [
      "8c50d6f34c16de1f2309b812291f7ae801cbf5679384b80ce0859a7f9da31761",
      "dff6fbbbf863338a33e2701fa0502f008fe48ef4cd46a475d4c0562acb46e745",
      "57c5b3030de7dc0ae025bf25384ef0514f22eba5d73d7cfd8725b335d06d6e3a",
      "bf53c851e68bd19c0bcf1be2c1c0ea94c3afb472b519484ff158c97e7b35497b",
    ]);
    assert.deepEqual(await builtTiers(project), {
      fast: { model: "haiku", effort: "not written" },
      balanced: { model: "sonnet", effort: "not written" },
      deep: { model: "opus", effort: "not written" },
    });
  } finally {
    await project.remove();
  }
});

test("with tiers set, bay build writes into each step agent the model and the effort of its skill's tier", async () => {
  const project = await projectWithEveryTier({
    fast: { model: "sonnet", effort: "low" },
    balanced: { model: "opus", effort: "high" },
    deep: { model: "haiku", effort: "max" },
  });
  try {
    assert.equal(ran(project, ["check"]).status, 0);
    assert.equal(ran(project, ["build"]).status, 0);
    assert.deepEqual(await builtTiers(project), {
      fast: { model: "sonnet", effort: "low" },
      balanced: { model: "opus", effort: "high" },
      deep: { model: "haiku", effort: "max" },
    });
    const header = frontMatter(await project.read(agentFiles.deep));
    assert.deepEqual(Object.keys(header), ["name", "description", "tools", "model", "effort"]);
  } finally {
    await project.remove();
  }
});

test("a tier the config leaves out keeps the adapter's model and writes no effort", async () => {
  const project = await projectWithEveryTier({ deep: { model: "sonnet", effort: "medium" } });
  try {
    assert.equal(ran(project, ["build"]).status, 0);
    assert.deepEqual(await builtTiers(project), {
      fast: { model: "haiku", effort: "not written" },
      balanced: { model: "sonnet", effort: "not written" },
      deep: { model: "sonnet", effort: "medium" },
    });
  } finally {
    await project.remove();
  }
});

test("a tier with a model and no effort writes the model and no effort", async () => {
  const project = await projectWithEveryTier({ balanced: { model: "opus" } });
  try {
    assert.equal(ran(project, ["build"]).status, 0);
    assert.deepEqual((await builtTiers(project)).balanced, { model: "opus", effort: "not written" });
  } finally {
    await project.remove();
  }
});

test("after the setting changes, the next bay build updates the step agents it changes and no others", async () => {
  const project = await projectWithEveryTier();
  try {
    assert.equal(ran(project, ["build"]).status, 0);
    await setTiers(project, { deep: { model: "opus", effort: "medium" } });
    const rebuilt = ran(project, ["build"]);
    assert.equal(rebuilt.status, 0);
    const agentLines = rebuilt.output.split("\n").filter((line) => line.startsWith(".claude/agents/"));
    assert.deepEqual(agentLines, [
      ".claude/agents/agentbay-writer-careful.md: updated",
      ".claude/agents/agentbay-writer-draft.md: unchanged",
      ".claude/agents/agentbay-writer-quick.md: unchanged",
    ]);
  } finally {
    await project.remove();
  }
});

test("bay build refuses a model the adapter does not know, names the models it knows, and writes nothing", async () => {
  const project = await projectWithEveryTier({ deep: { model: "gpt-5", effort: "medium" } });
  try {
    const built = ran(project, ["build"]);
    assert.equal(built.status, 1);
    assert.match(
      built.output,
      /The tier deep names the model gpt-5, which the claude-code adapter does not know\. It knows haiku, sonnet, opus and fable\./,
    );
    await assert.rejects(project.read(agentFiles.deep));
    await assert.rejects(project.read(".agentbay/build.json"));
  } finally {
    await project.remove();
  }
});

test("bay check and bay build refuse a tier the kit does not have", async () => {
  const project = await projectWithEveryTier({ huge: { model: "opus", effort: "medium" } });
  try {
    for (const words of [["check"], ["build"]]) {
      const refused = ran(project, words);
      assert.equal(refused.status, 1, words.join(" "));
      assert.match(refused.output, /tiers has the field huge, which is not allowed here\./, words.join(" "));
    }
  } finally {
    await project.remove();
  }
});

test("bay check and bay build refuse an effort the kit does not have", async () => {
  const project = await projectWithEveryTier({ deep: { model: "opus", effort: "extreme" } });
  try {
    for (const words of [["check"], ["build"]]) {
      const refused = ran(project, words);
      assert.equal(refused.status, 1, words.join(" "));
      assert.match(
        refused.output,
        /tiers\.deep\.effort must be one of "low", "medium", "high", "xhigh", "max", but it is "extreme"\./,
        words.join(" "),
      );
    }
  } finally {
    await project.remove();
  }
});

test("the kit's config sets balanced to Sonnet at medium effort and deep to Opus at medium effort", async () => {
  const config: unknown = parse(await readFile(join(kit, "agentbay.config.yaml"), "utf8"));
  assert.deepEqual(fieldOf(config, "tiers"), {
    balanced: { model: "sonnet", effort: "medium" },
    deep: { model: "opus", effort: "medium" },
  });
});
