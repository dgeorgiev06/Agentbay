import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { isRecord } from "../bay/json.ts";
import { layoutOf } from "../bay/layout.ts";
import type { FileSystem } from "../bay/ports.ts";
import { roles, tierOfRole, type Role } from "../bay/roles.ts";
import { fakeFileSystem } from "./fakes.ts";
import { kit } from "./project-fixture.ts";
import { built, kitFiles } from "./roles-fixture.ts";
import { layout as fakeLayout, notesMode, paths, rooted, validFiles, yamlText } from "./system-fixture.ts";
import { toolsFor } from "../adapters/claude-code/agent-file.ts";

function roleOfTier(tier: string): Role | undefined {
  return roles.find((role) => tierOfRole(role) === tier);
}

function stepWithRole(step: Readonly<Record<string, unknown>>): unknown {
  if (typeof step.tier !== "string") {
    return step;
  }
  const { tier, ...rest } = step;
  const role = roleOfTier(tier);
  assert.ok(role !== undefined, `no role has the tier ${tier}`);
  return { ...rest, role };
}

test("every kit step that names its tier could name a role of that tier, and the kit's agent files keep every byte", async () => {
  const layout = layoutOf({ kit, project: kit });
  const byTier = await built(kitFiles(layout), layout);
  const byRole = await built(kitFiles(layout, stepWithRole), layout);
  assert.equal(byTier.agents.length, 13);
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

test("a reviewer's agent file names the model of the deep tier, the same file a step at tier deep gets", async () => {
  const config: unknown = parse(validFiles()[paths.config] ?? "");
  const tiers = { balanced: { model: "sonnet", effort: "medium" }, deep: { model: "opus", effort: "high" } };
  const withTiers = { [paths.config]: stringify({ ...(isRecord(config) ? config : {}), tiers }) };
  const filesOf = (step: unknown): FileSystem => fakeFileSystem(rooted({ ...baseNotesFiles(step), ...withTiers }));
  const byRole = await built(filesOf({ skill: "skills/write-note", role: "reviewer" }), fakeLayout);
  const byTier = await built(filesOf({ skill: "skills/write-note", tier: "deep" }), fakeLayout);
  const agentFile = byRole.files[".claude/agents/agentbay-notes-write-note.md"] ?? "";
  assert.match(agentFile, /^model: opus$/m);
  assert.match(agentFile, /^effort: high$/m);
  assert.deepEqual(byRole.files, byTier.files);
});
