import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, textField } from "../bay/json.ts";
import type { Kernel } from "../bay/kernel.ts";
import type { StoredRun } from "../bay/run-store.ts";
import { issueTaskToken } from "../bay/task-tokens.ts";
import { callKernelTool } from "../bay/tools.ts";
import { problemText, type Outcome } from "../bay/outcome.ts";
import { openKernel, openProject, type Opened } from "./kernel-fixture.ts";
import { makeProject, skillText } from "./project-fixture.ts";

const toolResultBytes = 256 * 1024;

type Waiting = {
  readonly runId: string;
  readonly stepKey: string;
  readonly token: string;
};

async function waitingCompose(kernel: Kernel): Promise<Waiting> {
  const result = await kernel.engine.startAction("writer.compose", { name: "Ada" });
  assert.ok(result.ok && result.value.state.status === "waiting", JSON.stringify(result));
  const waiting = result.value.state.waiting;
  assert.equal(waiting.reason, "skill");
  const place = { runId: result.value.id, stepKey: waiting.stepKey, round: 1 };
  return { ...place, token: await issueTaskToken(kernel.store, place, new Date()) };
}

function valueOf(result: Outcome<Json>): Json {
  assert.ok(result.ok, result.ok ? "" : problemText(result.problems));
  return result.value;
}

function refusalOf(result: Outcome<Json>): string {
  assert.ok(!result.ok, `expected a refusal, got ${JSON.stringify(result)}`);
  return problemText(result.problems);
}

async function withWaiting(body: (opened: Opened, waiting: Waiting) => Promise<void>): Promise<void> {
  const opened = await openProject({}, { environment: { AGENTBAY_SECRET_NOTE_KEY: "s3cr3t-note-value-42" } });
  try {
    await body(opened, await waitingCompose(opened.kernel));
  } finally {
    await opened.close();
  }
}

test("db_query runs one select on the mode's own database, migrated first, and records the call", async () => {
  await withWaiting(async ({ kernel }, waiting) => {
    const result = await callKernelTool(kernel, "db_query", { token: waiting.token, sql: "select text from notes" });
    assert.deepEqual(valueOf(result), { columns: ["text"], rows: [["The first note."]] });
    const refused = await callKernelTool(kernel, "db_query", { token: waiting.token, sql: "delete from notes" });
    assert.match(refusalOf(refused), /refused|read-only|select/i);
    const events = await kernel.store.readEvents(waiting.runId);
    const calls = events.filter((event) => event.kind === "tool.called").map((event) => event.detail);
    assert.deepEqual(calls, [
      { tool: "db_query", stepKey: waiting.stepKey, ok: true },
      { tool: "db_query", stepKey: waiting.stepKey, ok: false },
    ]);
  });
});

test("a call without a token, with a wrong token or to an unknown tool is refused", async () => {
  await withWaiting(async ({ kernel }, waiting) => {
    assert.match(refusalOf(await callKernelTool(kernel, "db_query", { sql: "select 1" })), /needs token/);
    assert.match(refusalOf(await callKernelTool(kernel, "db_query", "just text")), /needs token/);
    const wrong = await callKernelTool(kernel, "db_query", { token: "made-up", sql: "select 1" });
    assert.match(refusalOf(wrong), /The token is not valid/);
    const unknown = await callKernelTool(kernel, "shell", { token: waiting.token, command: "ls" });
    assert.match(refusalOf(unknown), /There is no kernel tool shell/);
  });
});

test("a tool the skill's Tools section does not name is refused; submit is always allowed", async () => {
  await withWaiting(async ({ kernel, project }, waiting) => {
    const withoutTools = skillText.replace("- db\n- files\n- greeting-source.fetch\n- compose\n", "- events\n");
    await project.write("components/modes/writer/skills/draft/SKILL.md", withoutTools);
    for (const [tool, input] of [
      ["db_query", { sql: "select 1" }],
      ["files_read", { path: "components/modes/writer/mode.yaml" }],
      ["call_action", { action: "greeting-source.fetch" }],
    ] as const) {
      const refusal = refusalOf(await callKernelTool(kernel, tool, { token: waiting.token, ...input }));
      assert.match(refusal, new RegExp(`does not name the tool ${tool} in its Tools section; it may use: submit`));
    }
    const submitted = await callKernelTool(kernel, "submit", { token: waiting.token, output: {} });
    assert.equal(fieldOf(valueOf(submitted), "accepted"), false);
  });
});

test("the file tools stay inside the step's paths", async () => {
  await withWaiting(async ({ kernel, project }, waiting) => {
    const token = waiting.token;
    const manifest = await callKernelTool(kernel, "files_read", { token, path: "components/modes/writer/mode.yaml" });
    assert.match(textField(valueOf(manifest), "text") ?? "", /name: writer/);
    const listed = await callKernelTool(kernel, "files_list", { token, path: "components/modes/writer/schemas" });
    assert.ok(JSON.stringify(valueOf(listed)).includes("draft-output.json"));
    const written = await callKernelTool(kernel, "files_write", { token, path: "out/notes/a.txt", text: "kept" });
    assert.deepEqual(valueOf(written), { written: "out/notes/a.txt" });
    assert.equal(await project.read("out/notes/a.txt"), "kept");
    const outside = await callKernelTool(kernel, "files_read", { token, path: "agentbay.config.yaml" });
    assert.match(refusalOf(outside), /may read only/);
    const absolute = await callKernelTool(kernel, "files_read", { token, path: "/etc/passwd" });
    assert.match(refusalOf(absolute), /may read only/);
    const ownCode = await callKernelTool(kernel, "files_write", {
      token,
      path: "components/modes/writer/mode.yaml",
      text: "x",
    });
    assert.match(refusalOf(ownCode), /may write only/);
    const climbing = await callKernelTool(kernel, "files_write", { token, path: "out/notes/../../x.txt", text: "x" });
    assert.match(refusalOf(climbing), /may write only/);
  });
});

test("call_action runs a listed read-only action through the engine and refuses any other", async () => {
  await withWaiting(async ({ kernel }, waiting) => {
    const token = waiting.token;
    const fetched = await callKernelTool(kernel, "call_action", {
      token,
      action: "greeting-source.fetch",
      input: { name: "Bo" },
    });
    const childRun = textField(valueOf(fetched), "run") ?? "";
    assert.deepEqual(valueOf(fetched), { output: { greeting: "Hello, Bo" }, run: childRun });
    const childEvents = await kernel.store.readEvents(childRun);
    const askedBy = childEvents.find((event) => event.kind === "run.asked-by");
    assert.deepEqual(askedBy?.detail, { runId: waiting.runId, stepKey: waiting.stepKey });
    const writing = await callKernelTool(kernel, "call_action", { token, action: "compose", input: { name: "Bo" } });
    assert.match(refusalOf(writing), /has the effects read, write; a skill may call only actions whose effects/);
    const unlisted = await callKernelTool(kernel, "call_action", { token, action: "greeter.fetch", input: {} });
    assert.match(refusalOf(unlisted), /does not list greeter.fetch under Tools/);
    const badInput = await callKernelTool(kernel, "call_action", { token, action: "greeting-source.fetch", input: {} });
    assert.match(refusalOf(badInput), /missing the required field name/);
  });
});

async function storedRun(kernel: Kernel, runId: string): Promise<StoredRun> {
  const run = await kernel.store.readRun(runId);
  assert.ok(run !== undefined, runId);
  return run;
}

test("an action a skill starts through call_action is charged to the calling run and held to what it has left", async () => {
  const project = await makeProject();
  const config = await project.read("agentbay.config.yaml");
  await project.write("agentbay.config.yaml", `${config}budget:\n  minutes: 30\n`);
  const kernel = await openKernel(project);
  try {
    const waiting = await waitingCompose(kernel);
    const before = await kernel.store.readRun(waiting.runId);
    const fetched = await callKernelTool(kernel, "call_action", {
      token: waiting.token,
      action: "greeting-source.fetch",
      input: { name: "Bo" },
    });
    const again = await callKernelTool(kernel, "call_action", {
      token: waiting.token,
      action: "greeting-source.fetch",
      input: { name: "Cy" },
    });
    const child = await storedRun(kernel, textField(valueOf(fetched), "run") ?? "");
    const second = await storedRun(kernel, textField(valueOf(again), "run") ?? "");
    const after = await storedRun(kernel, waiting.runId);
    assert.ok(before !== undefined);
    assert.ok(child.spent.minutes > 0 && second.spent.minutes > 0);
    assert.equal(child.limit.minutes, 30 - before.spent.minutes);
    assert.ok((second.limit.minutes ?? 30) < (child.limit.minutes ?? 0));
    const charged = after.spent.minutes - before.spent.minutes;
    assert.ok(Math.abs(charged - child.spent.minutes - second.spent.minutes) < 1e-9);
    assert.equal(after.state.status, "waiting");
    const output = { text: "Hello, Ada, and welcome back." };
    const accepted = valueOf(await callKernelTool(kernel, "submit", { token: waiting.token, output }));
    assert.equal(fieldOf(accepted, "accepted"), true);
    const done = await kernel.store.readRun(waiting.runId);
    const skillStep = done?.steps.find((step) => step.key === "1");
    assert.ok(skillStep !== undefined && skillStep.status !== "started");
    assert.ok(skillStep.spent.minutes >= child.spent.minutes + second.spent.minutes);
  } finally {
    kernel.close();
    await project.remove();
  }
});

test("tool results pass through the scrubber and are capped in size", async () => {
  await withWaiting(async ({ kernel, project }, waiting) => {
    const permissions = { ...kernel.policyOf("writer"), secrets: ["NOTE_KEY"] };
    assert.ok((await kernel.secrets.get("NOTE_KEY", permissions)).ok);
    await project.write("out/notes/leak.txt", "key s3cr3t-note-value-42 and ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    const read = await callKernelTool(kernel, "files_read", { token: waiting.token, path: "out/notes/leak.txt" });
    const text = textField(valueOf(read), "text") ?? "";
    assert.ok(!text.includes("s3cr3t-note-value-42") && !text.includes("ghp_abc"), text);
    assert.match(text, /\[redacted:NOTE_KEY\]/);
    await project.write("out/notes/big.txt", "x".repeat(toolResultBytes + 10));
    const big = await callKernelTool(kernel, "files_read", { token: waiting.token, path: "out/notes/big.txt" });
    assert.match(refusalOf(big), new RegExp(`over the cap of ${String(toolResultBytes)} bytes`));
  });
});

test("submit returns schema problems, then check feedback with a new token, then accepts", async () => {
  await withWaiting(async ({ kernel }, waiting) => {
    const wrongShape = valueOf(await callKernelTool(kernel, "submit", { token: waiting.token, output: { note: 1 } }));
    assert.equal(fieldOf(wrongShape, "accepted"), false);
    assert.match(JSON.stringify(fieldOf(wrongShape, "problems")), /missing the required field text/);
    const badSpend = await callKernelTool(kernel, "submit", { token: waiting.token, output: { text: "x" }, usd: -1 });
    assert.match(refusalOf(badSpend), /usd must be a number of at least 0/);
    const short = valueOf(await callKernelTool(kernel, "submit", { token: waiting.token, output: { text: "short" } }));
    assert.equal(fieldOf(short, "accepted"), false);
    assert.equal(fieldOf(short, "round"), 2);
    assert.deepEqual(fieldOf(short, "feedback"), ["The note has 5 characters; write at least 20."]);
    const next = textField(short, "token") ?? "";
    const replayed = await callKernelTool(kernel, "submit", {
      token: waiting.token,
      output: { text: "long enough now?" },
    });
    assert.match(refusalOf(replayed), /The token is not valid/);
    const paid = { token: next, output: { text: "Hello, Ada, and welcome back." }, tokens: 300, usd: 0.01 };
    const unpaid = valueOf(await callKernelTool(kernel, "submit", paid));
    assert.equal(fieldOf(unpaid, "accepted"), false);
    assert.match(
      JSON.stringify(fieldOf(unpaid, "problems")),
      /Reporting dollars an agent spent needs the spend effect/,
    );
    const good = { token: next, output: { text: "Hello, Ada, and welcome back." }, tokens: 300 };
    const accepted = valueOf(await callKernelTool(kernel, "submit", good));
    assert.deepEqual(accepted, { accepted: true, run: { id: waiting.runId, status: "done" } });
    const run = await kernel.store.readRun(waiting.runId);
    assert.equal(run?.spent.tokens, 300);
    const after = await callKernelTool(kernel, "db_query", { token: next, sql: "select 1" });
    assert.match(refusalOf(after), /no longer waiting for it \(the run is done\)/);
  });
});

test("submit never returns the token of the next skill step, and says how the coordinator gets its task", async () => {
  const opened = await openProject();
  try {
    const { kernel } = opened;
    const started = await kernel.engine.startWorkflow({ mode: "writer", path: "workflows/twice.yaml" }, {});
    assert.ok(started.ok && started.value.state.status === "waiting", JSON.stringify(started));
    const place = { runId: started.value.id, stepKey: started.value.state.waiting.stepKey, round: 1 };
    assert.equal(place.stepKey, "first/1#1");
    const token = await issueTaskToken(kernel.store, place, new Date());
    const output = { text: "Hello, Ada, and welcome back." };
    const submitted = valueOf(await callKernelTool(kernel, "submit", { token, output }));
    assert.deepEqual(submitted, {
      accepted: true,
      run: { id: place.runId, status: "waiting", waitingFor: "skill" },
      next: `The run waits for another skill step; bay runs ${place.runId} --new-token gives its task.`,
    });
  } finally {
    await opened.close();
  }
});

test("files_write is refused when the step's action does not declare the write effect", async () => {
  const project = await makeProject();
  const manifest = await project.read("components/modes/writer/mode.yaml");
  await project.write(
    "components/modes/writer/mode.yaml",
    manifest.replace("      - read\n      - write\n", "      - read\n"),
  );
  const kernel = await openKernel(project);
  const waiting = await waitingCompose(kernel);
  assert.deepEqual(kernel.system.modes.get("writer")?.manifest.actions.compose?.effects, ["read"]);
  const written = await callKernelTool(kernel, "files_write", {
    token: waiting.token,
    path: "out/notes/a.txt",
    text: "x",
  });
  assert.match(refusalOf(written), /Writing a file needs the write effect; to allow it, add write to actions.compose/);
  const read = await callKernelTool(kernel, "files_read", {
    token: waiting.token,
    path: "components/modes/writer/mode.yaml",
  });
  assert.ok(read.ok);
  kernel.close();
  await project.remove();
});

test("a skill step round gets a bounded number of tool calls; then only submit works", async () => {
  const project = await makeProject();
  const kernel = await openKernel(project, { limits: { toolCallsPerRound: 2 } });
  const waiting = await waitingCompose(kernel);
  const query = { token: waiting.token, sql: "select 1 as one" };
  assert.ok((await callKernelTool(kernel, "db_query", query)).ok);
  assert.ok(!(await callKernelTool(kernel, "files_read", { token: waiting.token, path: "nowhere" })).ok);
  const third = await callKernelTool(kernel, "db_query", query);
  assert.match(refusalOf(third), /has used its 2 tool calls\. Submit your output now with submit/);
  const short = valueOf(await callKernelTool(kernel, "submit", { token: waiting.token, output: { text: "short" } }));
  const next = textField(short, "token") ?? "";
  assert.ok((await callKernelTool(kernel, "db_query", { token: next, sql: "select 1" })).ok);
  kernel.close();
  await project.remove();
});

test("call_action starts an interface action for the skill's mode, which the callee sees as its caller", async () => {
  await withWaiting(async ({ kernel }, waiting) => {
    const fetched = await callKernelTool(kernel, "call_action", {
      token: waiting.token,
      action: "greeting-source.fetch",
      input: { name: "Bo" },
    });
    const childRun = await kernel.store.readRun(textField(valueOf(fetched), "run") ?? "");
    assert.deepEqual(childRun?.target, { kind: "action", mode: "greeter", name: "fetch", caller: "writer" });
  });
});

test("a tool's refusal is redacted by the tool layer itself, even when nothing else redacted it", async () => {
  await withWaiting(async ({ kernel }, waiting) => {
    const secret = "s3cr3t-note-value-42";
    const handedOut = await kernel.secrets.get("NOTE_KEY", { ...kernel.policyOf("writer"), secrets: ["NOTE_KEY"] });
    assert.ok(handedOut.ok);
    const refused = await callKernelTool(kernel, "call_action", { token: waiting.token, action: secret });
    const refusal = refusalOf(refused);
    assert.doesNotMatch(refusal, new RegExp(secret));
    assert.match(refusal, /The skill does not list \[redacted:NOTE_KEY\] under Tools/);
  });
});
