import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import type { Action } from "../bay/generated/mode.ts";
import { fieldOf, parseJson, textField } from "../bay/json.ts";
import type { Run } from "../bay/runs/runs.ts";
import { bay } from "./cli-fixture.ts";
import { openKernel } from "./kernel-fixture.ts";
import { makeProject, type Project } from "./project-fixture.ts";
import { answer, draftSkill, notesFlow, openedRuns, runOf, tokenOf, withFlow, type Changes } from "./runs-fixture.ts";

const reviewDraft: Action = {
  description: "When a test has a reviewer draft a text.",
  input: "schemas/anything.json",
  output: "schemas/draft.json",
  effects: ["read"],
  run: [{ skill: "skills/draft", role: "reviewer", checks: ["scripts/long-enough.ts"] }],
};

const reviewedPut: Action = {
  description: "When a mode keeps an item, as a reviewer drafts it.",
  effects: ["write"],
  run: [{ skill: "skills/draft", role: "reviewer" }],
  undo: "remove",
};

const storeSkillFiles = {
  "components/base/store/skills/draft/SKILL.md": draftSkill,
  "components/base/store/schemas/draft.json": "{}",
};

function skillDetails(run: Run): readonly Json[] {
  return run.steps.filter((step) => step.kind === "skill").map((step) => step.detail);
}

function rolesAndTiers(run: Run): readonly (readonly [string | undefined, string | undefined])[] {
  return skillDetails(run).map((detail) => [textField(detail, "role"), textField(detail, "tier")]);
}

async function withRoleInWriter(role: string): Promise<Project> {
  const project = await makeProject();
  const file = "components/modes/writer/mode.yaml";
  const text = await project.read(file);
  assert.equal(text.split("tier: balanced").length, 2, text);
  await project.write(file, text.replace("tier: balanced", `role: ${role}`));
  return project;
}

const printedTaskFields = [
  "agent",
  "feedback",
  "input",
  "outputSchema",
  "round",
  "runId",
  "skillFile",
  "stepKey",
  "token",
];

test("a reviewer's step is recorded at tier deep with its role, and keeps both when the kernel reopens", async () => {
  const project = await withRoleInWriter("reviewer");
  const kernel = await openKernel(project);
  const started = runOf(await kernel.runs.start({ action: "writer.compose" }, { name: "Ada" }));
  assert.deepEqual(rolesAndTiers(started), [["reviewer", "deep"]]);
  kernel.close();
  const reopened = await openKernel(project);
  assert.deepEqual(rolesAndTiers(runOf(await reopened.runs.show(started.id))), [["reviewer", "deep"]]);
  reopened.close();
  await project.remove();
});

test("the task bay call and bay runs print for a reviewer's step names its agent and holds no role and no tier", async () => {
  const project = await withRoleInWriter("reviewer");
  const called = await bay(["call", "writer.compose", '{"name":"Ada"}', "--project", project.root, "--json"]);
  assert.equal(called.exitCode, 0, called.output);
  const task = fieldOf(fieldOf(parseJson(called.output), "run") ?? null, "task") ?? null;
  assert.deepEqual(Object.keys(typeof task === "object" && task !== null ? task : {}).sort(), printedTaskFields);
  const runId = textField(task, "runId") ?? "";
  const shown = await bay(["runs", runId, "--project", project.root]);
  assert.equal(shown.exitCode, 0, shown.output);
  assert.match(shown.output, /task for the agent agentbay-writer-draft/);
  assert.doesNotMatch(`${called.output}\n${shown.output}`, /"role"|"tier"|reviewer/);
  await project.remove();
});

const changes: Changes = {
  ...withFlow([{ id: "review", action: "review-draft" }]),
  notesActions: { "review-draft": reviewDraft },
  storeActions: { put: reviewedPut },
  files: storeSkillFiles,
};

test("a role is kept in the second round of a skill step", async () => {
  const { runs, close } = await openedRuns({ changes });
  const first = runOf(await runs.start({ action: "notes.review-draft" }, {}));
  const second = runOf(await runs.submit(tokenOf(first), answer({ text: "short" })));
  assert.deepEqual(
    skillDetails(second).map((detail) => [fieldOf(detail, "round"), textField(detail, "role")]),
    [[2, "reviewer"]],
  );
  close();
});

test("a role is kept in a skill step a workflow's step runs", async () => {
  const { runs, close } = await openedRuns({ changes });
  const flowed = runOf(await runs.start({ workflow: notesFlow }, {}));
  assert.deepEqual(rolesAndTiers(flowed), [["reviewer", "deep"]]);
  close();
});

test("a role is kept in a skill step of an action that another mode's call step calls", async () => {
  const { runs, close } = await openedRuns({ changes });
  const called = runOf(await runs.start({ action: "notes.store-one" }, { id: "x" }));
  assert.deepEqual(rolesAndTiers(called), [["reviewer", "deep"]]);
  close();
});
