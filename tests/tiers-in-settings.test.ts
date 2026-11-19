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
  return createHash("sha256").update(text.replaceAll(project.root, "<project>"), "utf8").digest("hex");
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
      "ff779262b0301270f27f03ad49371385fb0a0f9642519a85538b126b8510df5c",
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
