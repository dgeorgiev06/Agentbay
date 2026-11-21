import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import type { Tier } from "../bay/contracts.ts";
import { isRecord } from "../bay/json.ts";
import { layoutOf } from "../bay/layout.ts";
import { tierOfRole, type Role } from "../bay/roles.ts";
import { kit } from "./project-fixture.ts";
import { built, kitFiles, type Built } from "./roles-fixture.ts";
import { toolsFor } from "../adapters/claude-code/agent-file.ts";

type ForgeStep = {
  readonly skill: string;
  readonly role: Role;
  readonly tierBefore: Tier;
  readonly writes: boolean;
};

const forgeSteps: readonly ForgeStep[] = [
  { skill: "skills/declare", role: "builder", tierBefore: "balanced", writes: false },
  { skill: "skills/build", role: "builder", tierBefore: "deep", writes: true },
  { skill: "skills/write-tests", role: "test writer", tierBefore: "balanced", writes: false },
  { skill: "skills/build-without-tests", role: "builder", tierBefore: "balanced", writes: true },
  { skill: "skills/review", role: "reviewer", tierBefore: "deep", writes: false },
  { skill: "skills/plant", role: "planter", tierBefore: "balanced", writes: false },
  { skill: "skills/design", role: "designer", tierBefore: "deep", writes: false },
  { skill: "skills/challenge", role: "challenger", tierBefore: "deep", writes: false },
  { skill: "skills/plan", role: "planner", tierBefore: "balanced", writes: false },
  { skill: "skills/challenge-plan", role: "challenger", tierBefore: "deep", writes: false },
];

const changedAgent = "agentbay-forge-build";

const readTools = ["mcp__agentbay__submit", "Read", "Glob", "Grep"];

async function skillStepsOf(manifest: string): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const parsed: unknown = parse(await readFile(join(kit, manifest), "utf8"));
  assert.ok(isRecord(parsed) && isRecord(parsed.actions));
  return Object.values(parsed.actions).flatMap((action) =>
    isRecord(action) && Array.isArray(action.run)
      ? action.run.filter((step): step is Record<string, unknown> => isRecord(step) && "skill" in step)
      : [],
  );
}

function stepBefore(step: Readonly<Record<string, unknown>>): unknown {
  const known = forgeSteps.find((candidate) => candidate.skill === step.skill && candidate.role === step.role);
  if (known === undefined) {
    return step;
  }
  const rest = Object.fromEntries(Object.entries(step).filter(([field]) => field !== "role"));
  return { ...rest, tier: known.tierBefore };
}

function agentOf(skill: string): string {
  return `agentbay-forge-${skill.replace("skills/", "")}`;
}

async function builtNowAndBefore(): Promise<{ readonly now: Built; readonly before: Built }> {
  const layout = layoutOf({ kit, project: kit });
  return { now: await built(kitFiles(layout), layout), before: await built(kitFiles(layout, stepBefore), layout) };
}

function differingLines(now: string, before: string): readonly string[] {
  const nowLines = now.split("\n");
  const beforeLines = before.split("\n");
  assert.equal(nowLines.length, beforeLines.length);
  return nowLines.flatMap((line, index) =>
    line === beforeLines[index] ? [] : [`${beforeLines[index] ?? ""} -> ${line}`],
  );
}

test("each of forge's ten skill steps names its role and no tier", async () => {
  const steps = await skillStepsOf("components/base/forge/mode.yaml");
  assert.deepEqual(
    steps.map((step) => ({ skill: step.skill, role: step.role, tier: step.tier })),
    forgeSteps.map(({ skill, role }) => ({ skill, role, tier: undefined })),
  );
});

test("the feed briefing's digest and ask keep tier balanced and name no role", async () => {
  const steps = await skillStepsOf("components/modes/feed-briefing/mode.yaml");
  assert.deepEqual(
    steps.map((step) => ({ skill: step.skill, role: step.role, tier: step.tier })),
    ["skills/digest", "skills/ask"].map((skill) => ({ skill, role: undefined, tier: "balanced" })),
  );
});

test("every forge step runs at the tier it ran at before, but the one-slice build, which moves from deep to balanced", () => {
  const moved = forgeSteps.filter((step) => tierOfRole(step.role) !== step.tierBefore);
  assert.deepEqual(
    moved.map((step) => [step.skill, step.tierBefore, tierOfRole(step.role)]),
    [["skills/build", "deep", "balanced"]],
  );
});

test("bay build writes the twelve agent files and steps.json as before, but the build agent's model", async () => {
  const { now, before } = await builtNowAndBefore();
  assert.equal(now.agents.length, 12);
  assert.deepEqual(Object.keys(now.files), Object.keys(before.files));
  const changedFile = `.claude/agents/${changedAgent}.md`;
  const changed = Object.keys(now.files).filter((path) => now.files[path] !== before.files[path]);
  assert.deepEqual(changed, [changedFile]);
  assert.deepEqual(differingLines(now.files[changedFile] ?? "", before.files[changedFile] ?? ""), [
    "model: opus -> model: sonnet",
  ]);
  assert.deepEqual(
    now.agents.map((agent) => [agent.agent, agent.tier]).filter(([agent]) => agent === changedAgent),
    [[changedAgent, "balanced"]],
  );
  assert.deepEqual(
    now.agents.map((agent) => (agent.agent === changedAgent ? { ...agent, tier: "deep" } : agent)),
    before.agents,
  );
});

test("each forge agent has the tools it had before: read and submit, and Write and Edit for the two builds", async () => {
  const { now } = await builtNowAndBefore();
  const toolsBySkill = forgeSteps.map((step) => {
    const agent = now.agents.find((candidate) => candidate.agent === agentOf(step.skill));
    assert.ok(agent !== undefined, step.skill);
    return [step.skill, toolsFor(agent)];
  });
  assert.deepEqual(
    toolsBySkill,
    forgeSteps.map((step) => [step.skill, step.writes ? [...readTools, "Write", "Edit"] : readTools]),
  );
});
