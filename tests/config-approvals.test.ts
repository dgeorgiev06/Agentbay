import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSystemReport } from "../bay/manifests/manifests.ts";
import { fakeFileSystem } from "./fakes.ts";
import { config, layout, paths, rooted, validFiles, yamlText } from "./system-fixture.ts";

function filesWith(approvals: unknown): Record<string, string> {
  return { ...validFiles(), [paths.config]: yamlText({ ...config, approvals }) };
}

test("the project config may list terminal and chat under approvals.from", async () => {
  const outcome = (await loadSystemReport(fakeFileSystem(rooted(filesWith({ from: ["terminal", "chat"] }))), layout))
    .outcome;
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems));
  assert.deepEqual(outcome.value.config.approvals, { from: ["terminal", "chat"] });
});

test("approvals.from refuses a channel that is neither terminal nor chat, and a repeated one", async () => {
  for (const from of [["email"], ["chat", "chat"]]) {
    const outcome = (await loadSystemReport(fakeFileSystem(rooted(filesWith({ from }))), layout)).outcome;
    assert.ok(!outcome.ok);
    assert.ok(
      outcome.problems.some((problem) => problem.file === paths.config && problem.path.startsWith("/approvals")),
    );
  }
});

test("approvals takes no field other than from", async () => {
  const outcome = (await loadSystemReport(fakeFileSystem(rooted(filesWith({ from: ["chat"], by: "anyone" }))), layout))
    .outcome;
  assert.ok(!outcome.ok);
  assert.ok(outcome.problems.some((problem) => problem.message.includes("has the field by")));
});
