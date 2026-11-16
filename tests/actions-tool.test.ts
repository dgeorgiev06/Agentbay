import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import { callKernelTool } from "../bay/tools.ts";
import { problemText, type Outcome } from "../bay/outcome.ts";
import { bay } from "./cli-fixture.ts";
import { openProject, startedTask } from "./kernel-fixture.ts";

const madeUpSecret = "made-up-secret-7f3a9c41";

function valueOf(result: Outcome<Json>): Json {
  assert.ok(result.ok, result.ok ? "" : problemText(result.problems));
  return result.value;
}

function refusalOf(result: Outcome<Json>): string {
  assert.ok(!result.ok, `expected a refusal, got ${JSON.stringify(result)}`);
  return problemText(result.problems);
}

const tokenTools = ["db_query", "files_read", "files_list", "files_write", "call_action", "submit"] as const;

test("the tool actions answers without a token; every other tool still refuses a call without one", async () => {
  const opened = await openProject();
  try {
    const { kernel } = opened;
    assert.deepEqual(valueOf(await callKernelTool(kernel, "actions", {})), {
      modes: [
        { name: "greeter", description: "Gives a greeting for a name." },
        { name: "writer", description: "Drafts a note from a greeting and keeps it." },
      ],
    });
    for (const name of tokenTools) {
      const refusal = refusalOf(await callKernelTool(kernel, name, {}));
      assert.equal(refusal, "Every tool call needs token: the token of your task, exactly as the task gave it.", name);
    }
  } finally {
    await opened.close();
  }
});

test("the tool actions takes only mode and find, each as text, and refuses a token", async () => {
  const opened = await openProject();
  try {
    const { kernel } = opened;
    const only = "The tool actions takes only mode and find, both optional text; it needs no token.";
    assert.equal(refusalOf(await callKernelTool(kernel, "actions", { token: "x" })), only);
    assert.equal(refusalOf(await callKernelTool(kernel, "actions", "greeter")), only);
    assert.equal(refusalOf(await callKernelTool(kernel, "actions", { mode: 3 })), only);
    assert.equal(refusalOf(await callKernelTool(kernel, "actions", { find: ["a"] })), only);
    const unknown = await callKernelTool(kernel, "shell", {});
    assert.match(refusalOf(unknown), /There is no kernel tool shell; the tools are actions, db_query, /);
  } finally {
    await opened.close();
  }
});

test("neither the tool nor the command shows a secret, a setting value or stored data", async () => {
  const opened = await openProject({}, { environment: { AGENTBAY_SECRET_NOTE_KEY: madeUpSecret } });
  try {
    const { kernel, project } = opened;
    const config = await project.read("agentbay.config.yaml");
    await project.write("agentbay.config.yaml", config.replace("Yours, the writer", madeUpSecret));
    const waiting = await startedTask(kernel, "writer.compose", { name: "Ada" });
    const stored = await callKernelTool(kernel, "db_query", { token: waiting.token, sql: "select text from notes" });
    assert.deepEqual(valueOf(stored), { columns: ["text"], rows: [["The first note."]] });
    const answers: string[] = [];
    for (const input of [{}, { mode: "writer" }, { mode: "greeter" }, { find: "note" }]) {
      answers.push(JSON.stringify(valueOf(await callKernelTool(kernel, "actions", input))));
    }
    for (const argv of [[], ["writer"], ["greeter"], ["--find", "note"]]) {
      for (const form of [[], ["--json"]]) {
        const ran = await bay(["actions", ...argv, "--project", project.root, ...form]);
        assert.equal(ran.exitCode, 0, ran.output);
        answers.push(ran.output);
      }
      const called = await bay(["call", "--tool", "actions", "{}", "--project", project.root, "--json"]);
      answers.push(called.output);
    }
    assert.equal(answers.length, 16);
    for (const answer of answers) {
      for (const hidden of [madeUpSecret, "Yours, the writer", "The first note.", "signature", "redacted"]) {
        assert.ok(!answer.includes(hidden), `${hidden} appears in ${answer}`);
      }
    }
  } finally {
    await opened.close();
  }
});
