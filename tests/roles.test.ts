import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { planAgents } from "../bay/build.ts";
import type { ListTrust, Tier } from "../bay/contracts.ts";
import { loadSystem, type System } from "../bay/manifests/manifests.ts";
import type { Problem } from "../bay/outcome.ts";
import { roles, tierOfRole, type Role } from "../bay/roles.ts";
import { listHashOf } from "../bay/trust.ts";
import { check } from "./check-fixture.ts";
import { fakeFileSystem } from "./fakes.ts";
import { kit } from "./project-fixture.ts";
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

const notARole =
  "which is not one of the kit's roles: builder, test writer, reviewer, planter, designer, challenger, planner.";

const notWrittenSo = "and the kit has no role written that way.";

function refusedRole(written: string, reason: string, fix: string): Problem {
  return {
    file: paths.notes,
    path: "/actions/add/run/0/role",
    line: 17,
    message: `Action add of mode notes names the role "${written}" for the skill skills/write-note, ${reason}`,
    fix,
  };
}

test("a step that names the role lead is refused with the seven names, the same at load and in bay check", async () => {
  assert.deepEqual(await sameInLoadAndCheck({ skill: "skills/write-note", role: "lead" }), [
    refusedRole("lead", notARole, "Name one of those roles, or name a tier in its place: fast, balanced, deep."),
  ]);
});

test("a role written in another case or with extra spaces is refused with the role it meant", async () => {
  assert.deepEqual(await sameInLoadAndCheck({ skill: "skills/write-note", role: "Reviewer" }), [
    refusedRole("Reviewer", notWrittenSo, "Write it in lower case, with one space between words: role: reviewer."),
  ]);
  assert.deepEqual(await sameInLoadAndCheck({ skill: "skills/write-note", role: "test  writer" }), [
    refusedRole(
      "test  writer",
      notWrittenSo,
      "Write it in lower case, with one space between words: role: test writer.",
    ),
  ]);
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

test("a step that names a role and the very tier that role gives is refused all the same", async () => {
  const problems = await sameInLoadAndCheck({ skill: "skills/write-note", role: "reviewer", tier: "deep" });
  assert.deepEqual(
    problems.map((problem) => problem.fix),
    ["Keep role: reviewer and remove tier: deep, or keep tier: deep and remove role: reviewer."],
  );
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

test("the README names the kit's roles, every one and no other, in the kernel's order", async () => {
  const readme = await readFile(join(kit, "README.md"), "utf8");
  const listed = /The kit's roles are ([^.]+), each with its tier/.exec(readme.replace(/\s+/g, " "))?.[1] ?? "";
  assert.deepEqual(listed.split(/, | and /), [...roles]);
});

test("ADR 29 lists each of the kit's roles once, under the tier the kernel gives it", async () => {
  const adr = (await readFile(join(kit, "docs/adr/0029-roles.md"), "utf8")).replace(/\s+/g, " ");
  const said = /\*\*The builder runs at balanced\.\*\* ([^;]+) are balanced; ([^.]+) are deep\./.exec(adr);
  const listed = (words: string | undefined): readonly string[] => (words ?? "").toLowerCase().split(/, | and /);
  assert.deepEqual(
    { balanced: listed(said?.[1]), deep: listed(said?.[2]) },
    {
      balanced: roles.filter((role) => tierOfRole(role) === "balanced"),
      deep: roles.filter((role) => tierOfRole(role) === "deep"),
    },
    "ADR 29 is a dated record of the roles decided on 21 November 2026: when bay/roles.ts no longer agrees with it, " +
      "write the later change of roles as a new ADR, and do not edit ADR 29.",
  );
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
