import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import { makeProject, type Project } from "./project-fixture.ts";
import { openModeProject, type ModeProject, type Run } from "./test-toolbox.ts";

const config = {
  bindings: { "greeting-source": "greeter" },
  adapter: "claude-code",
  settings: { writer: { signature: "Yours, the writer" } },
};

const replacedToken =
  "The token is not valid: it was never issued, or a newer token for the same task replaced it. " +
  "Ask the coordinator for the task again; it carries a fresh token.";

const note = "Hello, Ada, and welcome back.";

const composed = { text: note, saved: "out/notes/note.txt" };

const draftInput = { name: "Ada", greeting: { greeting: "Hello, Ada" } };

async function opened(beside: Project): Promise<ModeProject> {
  return openModeProject(config, { project: beside.root });
}

async function withProject(body: (project: ModeProject) => Promise<void>): Promise<void> {
  const beside = await makeProject();
  const project = await opened(beside);
  try {
    await body(project);
  } finally {
    await project.close();
    await beside.remove();
  }
}

type SkillWaiting = {
  readonly stepKey: string;
  readonly token: string | undefined;
  readonly round: number;
  readonly input: Json;
};

function skillWaitingOf(run: Run): SkillWaiting {
  if (run.state.status !== "waiting" || run.state.waiting.reason !== "skill") {
    assert.fail(`expected the run to wait for a skill, got ${JSON.stringify(run.state)}`);
  }
  const { stepKey, task } = run.state.waiting;
  return { stepKey, token: task.token, round: task.round, input: task.input };
}

function withTokenKind(run: Run): Json {
  const waiting = skillWaitingOf(run);
  return { ...waiting, token: typeof waiting.token };
}

function tokenOf(run: Run): string {
  const token = skillWaitingOf(run).token;
  assert.ok(token !== undefined, `the task carries no token: ${JSON.stringify(run.state)}`);
  return token;
}

test("a new token for the second skill step of a workflow is accepted, and the workflow ends", async () => {
  await withProject(async (project) => {
    const started = await project.runWorkflow("writer", "workflows/twice.yaml", {});
    const second = await project.answer(tokenOf(started), { text: note });
    assert.equal(skillWaitingOf(second).token, undefined);
    const given = await project.newToken(started.id);
    assert.equal(given.id, started.id);
    assert.deepEqual(withTokenKind(given), { stepKey: "second/1#1", token: "string", round: 1, input: draftInput });
    const done = await project.answer(tokenOf(given), { text: note });
    assert.equal(done.id, started.id);
    assert.deepEqual(done.state, { status: "done", output: composed });
  });
});

test("after a new token is given, the old one is refused with the kernel's sentence and the new one answers", async () => {
  await withProject(async (project) => {
    const started = await project.run("writer.compose", { name: "Ada" });
    const old = tokenOf(started);
    const fresh = tokenOf(await project.newToken(started.id));
    assert.notEqual(fresh, old);
    assert.equal(await project.answerRefusal(old, { text: note }), replacedToken);
    const done = await project.answer(fresh, { text: note });
    assert.deepEqual([done.id, done.state], [started.id, { status: "done", output: composed }]);
  });
});

test("a new token is given for the run named, never for another run that waits for a skill", async () => {
  await withProject(async (project) => {
    const first = await project.run("writer.compose", { name: "Ada" });
    const other = await project.run("writer.compose", { name: "Ada" });
    const given = await project.newToken(first.id);
    assert.equal(given.id, first.id);
    const done = await project.answer(tokenOf(given), { text: note });
    assert.deepEqual([done.id, done.state], [first.id, { status: "done", output: composed }]);
    assert.deepEqual(await project.runs(), [
      { id: other.id, status: "waiting" },
      { id: first.id, status: "done" },
    ]);
    const otherDone = await project.answer(tokenOf(other), { text: note });
    assert.deepEqual([otherDone.id, otherDone.state.status], [other.id, "done"]);
  });
});

test("a new token asked for a run that waits for an approval gives the run as it stands, with no task", async () => {
  await withProject(async (project) => {
    const review = await project.runWorkflow("writer", "workflows/review.yaml", { name: "Ada" });
    await project.run("writer.compose", { name: "Ada" });
    const given = await project.newToken(review.id);
    assert.equal(given.id, review.id);
    assert.deepEqual(given.state, review.state);
    if (given.state.status !== "waiting" || given.state.waiting.reason !== "approval") {
      assert.fail(`expected an approval, got ${JSON.stringify(given.state)}`);
    }
    const { reason, stepKey, question, content } = given.state.waiting;
    assert.deepEqual(
      { reason, stepKey, question, content },
      { reason: "approval", stepKey: "keep", question: "Keep this greeting?", content: { greeting: "Hello, Ada" } },
    );
    assert.equal("task" in given.state.waiting, false);
  });
});

test("a new token asked for a run that is done gives the run as it stands, with no task", async () => {
  await withProject(async (project) => {
    const done = await project.run("greeter.fetch", { name: "Ada" });
    await project.run("writer.compose", { name: "Ada" });
    const given = await project.newToken(done.id);
    assert.equal(given.id, done.id);
    assert.deepEqual(given.state, { status: "done", output: { greeting: "Hello, Ada" } });
  });
});

test("a new token asked for a run that does not exist is refused with the kernel's sentence", async () => {
  await withProject(async (project) => {
    assert.equal(await project.newTokenRefusal("nope"), "There is no run nope.");
    const started = await project.run("writer.compose", { name: "Ada" });
    await assert.rejects(project.newTokenRefusal(started.id), /expected the new token to be refused/);
    await assert.rejects(project.newToken("nope"), /There is no run nope\./);
  });
});

test("a token given before the kernel ends answers after it opens again, and the one it replaced does not", async () => {
  const beside = await makeProject();
  let project = await opened(beside);
  try {
    const started = await project.run("writer.compose", { name: "Ada" });
    const old = tokenOf(started);
    const fresh = tokenOf(await project.newToken(started.id));
    project = await project.endKernel().openAgain();
    assert.equal(await project.answerRefusal(old, { text: note }), replacedToken);
    const done = await project.answer(fresh, { text: note });
    assert.deepEqual([done.id, done.state], [started.id, { status: "done", output: composed }]);
  } finally {
    await project.close();
    await beside.remove();
  }
});

test("a token given after the kernel opens again answers, and the one given before it does not", async () => {
  const beside = await makeProject();
  let project = await opened(beside);
  try {
    const started = await project.run("writer.compose", { name: "Ada" });
    const old = tokenOf(started);
    project = await project.endKernel().openAgain();
    const given = await project.newToken(started.id);
    assert.deepEqual(withTokenKind(given), { stepKey: "1#1", token: "string", round: 1, input: draftInput });
    assert.equal(await project.answerRefusal(old, { text: note }), replacedToken);
    const done = await project.answer(tokenOf(given), { text: note });
    assert.deepEqual([done.id, done.state], [started.id, { status: "done", output: composed }]);
  } finally {
    await project.close();
    await beside.remove();
  }
});
