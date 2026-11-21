import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { planAgents } from "../bay/build.ts";
import type { ListTrust, Tier } from "../bay/contracts.ts";
import { fieldOf, parseJson, textField } from "../bay/json.ts";
import { loadSystem, type System } from "../bay/manifests/manifests.ts";
import type { Problem } from "../bay/outcome.ts";
import { roles, tierOfRole, type Role } from "../bay/roles.ts";
import { listHashOf } from "../bay/trust.ts";
import { check } from "./check-fixture.ts";
import { listOf } from "./cli-fixture.ts";
import { fakeFileSystem } from "./fakes.ts";
import { openKernel } from "./kernel-fixture.ts";
import { kit, makeProject } from "./project-fixture.ts";
import { layout, notesMode, paths, rooted, trustRecordFiles, validFiles, yamlText } from "./system-fixture.ts";

const designedTiers: Readonly<Record<Role, Tier>> = {
  builder: "balanced",
  "test writer": "balanced",
  reviewer: "deep",
  planter: "balanced",
  designer: "deep",
  challenger: "deep",
  planner: "balanced",
};

function notesWithStep(step: unknown): Readonly<Record<string, string>> {
  const add = { ...notesMode.actions.add, run: [step, { call: "items-store.put" }] };
  return { ...validFiles(), [paths.notes]: yamlText({ ...notesMode, actions: { add } }) };
}

async function loaded(files: Readonly<Record<string, string>>): Promise<System> {
  const outcome = await loadSystem(fakeFileSystem(rooted(files)), layout);
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  return outcome.value;
}

async function refusals(files: Readonly<Record<string, string>>): Promise<readonly Problem[]> {
  const outcome = await loadSystem(fakeFileSystem(rooted(files)), layout);
  assert.ok(!outcome.ok, "expected the system to be refused");
  return outcome.problems.filter((problem) => problem.file === paths.notes);
}

async function plannedTier(step: unknown): Promise<Tier | undefined> {
  const planned = await planAgents(await loaded(notesWithStep(step)));
  assert.ok(planned.ok, planned.ok ? "" : JSON.stringify(planned.problems));
  return planned.value.find((agent) => agent.agent === "agentbay-notes-write-note")?.tier;
}

async function checkedSentences(files: Readonly<Record<string, string>>): Promise<readonly string[]> {
  const report = await check(files);
  return report.findings
    .filter((finding) => finding.severity === "error" && finding.file === paths.notes)
    .map((finding) => `${finding.message} ${finding.fix ?? ""}`);
}

async function sameInLoadAndCheck(step: unknown): Promise<readonly Problem[]> {
  const files = notesWithStep(step);
  const problems = await refusals(files);
  const sentences = problems.map((problem) => `${problem.message} ${problem.fix ?? ""}`);
  assert.deepEqual(await checkedSentences(files), sentences);
  return problems;
}

test("each role of the kit names the tier the design gives it, and no other role exists", () => {
  assert.deepEqual(Object.fromEntries(roles.map((role) => [role, tierOfRole(role)])), designedTiers);
});

test("a skill step that names a role loads, and its agent runs at the role's tier", async () => {
  assert.equal(await plannedTier({ skill: "skills/write-note", role: "reviewer" }), "deep");
  assert.equal(await plannedTier({ skill: "skills/write-note", role: "builder" }), "balanced");
  for (const role of roles) {
    assert.equal(await plannedTier({ skill: "skills/write-note", role }), designedTiers[role], role);
  }
});

test("a skill step that names a tier and no role loads exactly as before", async () => {
  const step = { skill: "skills/write-note", tier: "fast" };
  const system = await loaded(notesWithStep(step));
  assert.deepEqual(system.modes.get("notes")?.manifest.actions.add?.run[0], step);
  assert.equal(await plannedTier(step), "fast");
});

test("a step that names the role lead is refused by the schema, the same at load and in bay check", async () => {
  const problems = await sameInLoadAndCheck({ skill: "skills/write-note", role: "lead" });
  assert.deepEqual(
    problems.map((problem) => [problem.path, problem.message]),
    [
      [
        "/actions/add/run/0/role",
        "actions.add.run.0.role must be one of " +
          '"builder", "test writer", "reviewer", "planter", "designer", "challenger", "planner", but it is "lead".',
      ],
    ],
  );
});

test("a step that names both a role and a tier is refused with a sentence that says to keep one", async () => {
  const problems = await sameInLoadAndCheck({ skill: "skills/write-note", role: "reviewer", tier: "fast" });
  assert.deepEqual(problems, [
    {
      file: paths.notes,
      path: "/actions/add/run/0",
      line: 16,
      message:
        "Action add of mode notes names both the role reviewer and the tier fast for the skill skills/write-note; " +
        "a role gives its step a tier, deep for the reviewer, so a step names one or the other.",
      fix: "Keep role: reviewer and remove tier: fast, or keep tier: fast and remove role: reviewer.",
    },
  ]);
});

test("a step that names neither a role nor a tier is refused with the names it may take", async () => {
  const problems = await sameInLoadAndCheck({ skill: "skills/write-note" });
  assert.deepEqual(problems, [
    {
      file: paths.notes,
      path: "/actions/add/run/0",
      line: 16,
      message:
        "Action add of mode notes names neither a role nor a tier for the skill skills/write-note, " +
        "so the kernel cannot say how capable a model its agent needs.",
      fix:
        "Add role: with one of builder, test writer, reviewer, planter, designer, challenger, planner; " +
        "or tier: with one of fast, balanced, deep.",
    },
  ]);
});

test("the schema's roles are the kernel's roles, in the same order", async () => {
  const schema = parseJson(await readFile(join(kit, "schemas", "mode.schema.json"), "utf8"));
  const step = fieldOf(fieldOf(schema, "$defs") ?? null, "step") ?? null;
  const skillBranch = listOf(fieldOf(step, "oneOf")).find(
    (branch) => fieldOf(fieldOf(branch, "properties") ?? null, "skill") !== undefined,
  );
  const role = fieldOf(fieldOf(skillBranch ?? null, "properties") ?? null, "role");
  assert.deepEqual(fieldOf(role ?? null, "enum"), [...roles]);
});

async function withRoleInWriter(role: Role): Promise<Awaited<ReturnType<typeof makeProject>>> {
  const project = await makeProject();
  const file = "components/modes/writer/mode.yaml";
  const text = await project.read(file);
  assert.equal(text.split("tier: balanced").length, 2, text);
  await project.write(file, text.replace("tier: balanced", `role: ${role}`));
  return project;
}

test("the run's record and the task carry the role of a step that names one, and keep it when the kernel reopens", async () => {
  const project = await withRoleInWriter("test writer");
  const kernel = await openKernel(project);
  const started = await kernel.runs.start({ action: "writer.compose" }, { name: "Ada" });
  assert.ok(started.ok && started.value.state.status === "waiting", JSON.stringify(started));
  const { waiting } = started.value.state;
  assert.ok(waiting.reason === "skill");
  assert.equal(waiting.task.role, "test writer");
  assert.equal(waiting.task.tier, "balanced");
  const skillStep = started.value.steps.find((step) => step.kind === "skill");
  assert.equal(textField(skillStep?.detail ?? null, "role"), "test writer");
  assert.equal(textField(skillStep?.detail ?? null, "tier"), "balanced");
  kernel.close();
  const reopened = await openKernel(project);
  const shown = await reopened.runs.show(started.value.id);
  assert.ok(shown.ok && shown.value.state.status === "waiting" && shown.value.state.waiting.reason === "skill");
  assert.equal(shown.value.state.waiting.task.role, "test writer");
  reopened.close();
  await project.remove();
});

test("the run's record and the task of a step that names only a tier carry no role", async () => {
  const project = await makeProject();
  const kernel = await openKernel(project);
  const started = await kernel.runs.start({ action: "writer.compose" }, { name: "Ada" });
  assert.ok(started.ok && started.value.state.status === "waiting", JSON.stringify(started));
  const { waiting } = started.value.state;
  assert.ok(waiting.reason === "skill");
  assert.equal("role" in waiting.task, false);
  const skillStep = started.value.steps.find((step) => step.kind === "skill");
  assert.equal(fieldOf(skillStep?.detail ?? null, "role"), undefined);
  kernel.close();
  await project.remove();
});

function listingNotes(step: unknown, record: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
  const add = { ...notesMode.actions.add, run: [step, { call: "items-store.put" }] };
  const resources = { commands: { probe: { run: "node --version", effects: ["read", "write"] } } };
  return { ...validFiles(), ...record, [paths.notes]: yamlText({ ...notesMode, resources, actions: { add } }) };
}

async function notesTrust(files: Readonly<Record<string, string>>): Promise<ListTrust> {
  return (await loaded(files)).modes.get("notes")?.grants.listTrust ?? { state: "not needed" };
}

test("a role stays out of the trust hash: a list trusted with tier steps stays trusted when its steps name roles", async () => {
  const byTier = await notesTrust(listingNotes({ skill: "skills/write-note", tier: "balanced" }));
  const byRole = await notesTrust(listingNotes({ skill: "skills/write-note", role: "builder" }));
  assert.ok(byTier.state === "never trusted" && byRole.state === "never trusted");
  assert.deepEqual(byRole.list, byTier.list);
  assert.equal(listHashOf(byRole.list), listHashOf(byTier.list));
  const record = trustRecordFiles(byTier.list);
  const trusted = await notesTrust(listingNotes({ skill: "skills/write-note", role: "reviewer" }, record));
  assert.equal(trusted.state, "trusted");
});
