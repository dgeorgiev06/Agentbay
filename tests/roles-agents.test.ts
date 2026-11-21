import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import type { SkillAgent } from "../bay/adapter.ts";
import { planAgents } from "../bay/build.ts";
import { isRecord } from "../bay/json.ts";
import { layoutOf, type Layout } from "../bay/layout.ts";
import { loadSystem } from "../bay/manifests/manifests.ts";
import { nodeFileSystem } from "../bay/node-ports.ts";
import type { FileSystem } from "../bay/ports.ts";
import { roles, tierOfRole, type Role } from "../bay/roles.ts";
import { fakeFileSystem } from "./fakes.ts";
import { kit } from "./project-fixture.ts";
import { layout as fakeLayout, notesMode, paths, rooted, validFiles, yamlText } from "./system-fixture.ts";
import { agentFileText, toolsFor } from "../adapters/claude-code/agent-file.ts";
import { stepsFileText } from "../adapters/claude-code/steps-file.ts";
import { tierSettings } from "../adapters/claude-code/tiers.ts";

const everyKitMode = ["forge", "feed-briefing", "typescript", "git-worktrees"];

type Built = {
  readonly agents: readonly SkillAgent[];
  readonly files: Readonly<Record<string, string>>;
};

function roleOfTier(tier: string): Role | undefined {
  return roles.find((role) => tierOfRole(role) === tier);
}

function stepWithRole(step: unknown): unknown {
  if (!isRecord(step) || typeof step.tier !== "string") {
    return step;
  }
  const { tier, ...rest } = step;
  const role = roleOfTier(tier);
  assert.ok(role !== undefined, `no role has the tier ${tier}`);
  return { ...rest, role };
}

function manifestWithRoles(text: string): string {
  const manifest: unknown = parse(text);
  if (!isRecord(manifest) || !isRecord(manifest.actions)) {
    return text;
  }
  const actions = Object.fromEntries(
    Object.entries(manifest.actions).map(([name, action]) => [
      name,
      isRecord(action) && Array.isArray(action.run) ? { ...action, run: action.run.map(stepWithRole) } : action,
    ]),
  );
  return stringify({ ...manifest, actions });
}

function kitFiles(layout: Layout, withRoles: boolean): FileSystem {
  return {
    ...nodeFileSystem,
    readText: async (path) => {
      const text = await nodeFileSystem.readText(path);
      if (text !== undefined && path === layout.configFile) {
        const config: unknown = parse(text);
        return stringify({ ...(isRecord(config) ? config : {}), modes: everyKitMode });
      }
      return text !== undefined && withRoles && path.endsWith("/mode.yaml") ? manifestWithRoles(text) : text;
    },
  };
}

async function built(files: FileSystem, layout: Layout): Promise<Built> {
  const system = await loadSystem(files, layout);
  assert.ok(system.ok, system.ok ? "" : JSON.stringify(system.problems, null, 2));
  const planned = await planAgents(system.value);
  assert.ok(planned.ok, planned.ok ? "" : JSON.stringify(planned.problems, null, 2));
  const tiers = tierSettings(system.value.config, layout.configFile);
  assert.ok(tiers.ok);
  const agentFiles = planned.value.map((agent): [string, string] => [
    `.claude/agents/${agent.agent}.md`,
    agentFileText(agent, layout.project, tiers.settings[agent.tier]),
  ]);
  const steps: [string, string] = [".agentbay/steps.json", stepsFileText(layout, planned.value)];
  return { agents: planned.value, files: Object.fromEntries([...agentFiles, steps]) };
}

test("every kit step that named its tier names a role of that tier, and the kit's agent files keep every byte", async () => {
  const layout = layoutOf({ kit, project: kit });
  const byTier = await built(kitFiles(layout, false), layout);
  const byRole = await built(kitFiles(layout, true), layout);
  assert.equal(byTier.agents.length, 12);
  assert.ok(["balanced", "deep"].every((tier) => byTier.agents.some((agent) => agent.tier === tier)));
  assert.deepEqual(byRole.agents, byTier.agents);
  assert.deepEqual(Object.keys(byRole.files), Object.keys(byTier.files));
  for (const [path, text] of Object.entries(byTier.files)) {
    assert.equal(byRole.files[path], text, path);
  }
});

function baseNotesFiles(step: unknown): Record<string, string> {
  const add = { ...notesMode.actions.add, run: [step, { call: "items-store.put" }] };
  const resources = { commands: { probe: { run: "node --version", effects: ["read", "write"] } } };
  const files = { ...validFiles(), [paths.notes]: yamlText({ ...notesMode, resources, actions: { add } }) };
  return Object.fromEntries(
    Object.entries(files).map(([path, text]) => [
      path.replace("components/modes/notes/", "components/base/notes/"),
      text,
    ]),
  );
}

test("a builder in a base mode that lists a command keeps Bash, its roots and its commands: a role only names a tier", async () => {
  const builder = roleOfTier("balanced");
  assert.equal(builder, "builder");
  const byTier = await built(
    fakeFileSystem(rooted(baseNotesFiles({ skill: "skills/write-note", tier: "balanced" }))),
    fakeLayout,
  );
  const byRole = await built(
    fakeFileSystem(rooted(baseNotesFiles({ skill: "skills/write-note", role: builder }))),
    fakeLayout,
  );
  const notesAgent = byRole.agents.find((agent) => agent.mode === "notes");
  assert.ok(notesAgent !== undefined);
  assert.ok(toolsFor(notesAgent).includes("Bash"), toolsFor(notesAgent).join(", "));
  assert.deepEqual(byRole.agents, byTier.agents);
  assert.deepEqual(byRole.files, byTier.files);
});
