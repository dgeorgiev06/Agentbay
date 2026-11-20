import assert from "node:assert/strict";
import { test } from "node:test";
import { withCapture, type Source } from "./recapture.ts";

const source: Source = {
  file: "given-x.json",
  test: "x.test.ts",
  name: "a case that reaches its card",
  anchor: 'const card = waitingOf(run, "card");',
  run: "run.id",
  capture: { before: "draw" },
};

const text = [
  'test("another case", async () => {',
  '  const card = waitingOf(run, "card");',
  "});",
  'test("a case that reaches its card", async () => {',
  '  const card = waitingOf(run, "card");',
  "});",
  "",
].join("\n");

test("recapture puts its capture just before the named case reads its card, and refuses a case it cannot find", () => {
  const lines = withCapture(text, source, "/out/given-x.json").split("\n");
  assert.deepEqual(lines.slice(0, 4), text.split("\n").slice(0, 4));
  assert.match(
    lines[4] ?? "",
    /^ {2}\(await import\("node:child_process"\)\)\.execFileSync\(process\.execPath, \[".*recapture\.ts", "--capture", root, run\.id, /,
  );
  assert.ok((lines[4] ?? "").includes(JSON.stringify(JSON.stringify({ before: "draw", into: "/out/given-x.json" }))));
  assert.equal(lines[5], '    const card = waitingOf(run, "card");');
  assert.throws(() => withCapture(text, { ...source, name: "a case not there" }, "/out/given-x.json"), {
    message: 'x.test.ts has no case "a case not there" that reads its card with: const card = waitingOf(run, "card");',
  });
});
