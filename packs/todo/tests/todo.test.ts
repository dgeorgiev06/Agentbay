import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const entry = join(import.meta.dirname, "..", "bin", "todo");
let home = "";

function todo(...args: string[]) {
  const run = spawnSync(entry, args, { env: { ...process.env, AGENTBAY_HOME: home }, encoding: "utf8" });
  return { code: run.status, out: JSON.parse(run.stdout), stderr: run.stderr };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "todo-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

test("add then list returns the todo, soonest due first", () => {
  assert.deepEqual(todo("add", '{"text":"  later  "}').out, { id: "t1", text: "later" });
  assert.deepEqual(todo("add", '{"text":"soon","due":"2026-12-01"}').out, {
    id: "t2",
    text: "soon",
    due: "2026-12-01",
  });
  const { code, out } = todo("list");
  assert.equal(code, 0);
  assert.deepEqual(
    out.todos.map((item: { id: string }) => item.id),
    ["t2", "t1"],
  );
});

test("blank text is refused, whatever the whitespace", () => {
  const { code, out } = todo("add", '{"text":" \\t\\n\\u00a0 "}');
  assert.equal(code, 1);
  assert.match(out.error, /empty/);
});

test("text is limited to 500 graphemes, not bytes", () => {
  assert.equal(todo("add", JSON.stringify({ text: "👨‍👩‍👧".repeat(500) })).code, 0);
  const { code, out } = todo("add", JSON.stringify({ text: "x".repeat(501) }));
  assert.equal(code, 1);
  assert.match(out.error, /500/);
});

test("an impossible due date is refused", () => {
  const { code, out } = todo("add", '{"text":"x","due":"2026-02-30"}');
  assert.equal(code, 1);
  assert.match(out.error, /YYYY-MM-DD/);
});

test("finish moves a todo from open to done", () => {
  todo("add", '{"text":"call the plumber"}');
  assert.deepEqual(todo("finish", '{"id":"t1"}').out, { id: "t1", done: true });
  assert.deepEqual(todo("list").out, { todos: [] });
  assert.equal(todo("list", '{"status":"done"}').out.todos[0].done, true);
  assert.match(todo("finish", '{"id":"t1"}').out.error, /already done/);
});

test("finish with an unknown id is an error", () => {
  const { code, out } = todo("finish", '{"id":"t9"}');
  assert.equal(code, 1);
  assert.match(out.error, /t9/);
});

test("unknown action and bad JSON are errors", () => {
  assert.equal(todo("remove", "{}").code, 1);
  const bad = todo("add", "{nope");
  assert.equal(bad.code, 1);
  assert.match(bad.out.error, /JSON/);
});

test("schema lists every action", () => {
  const { code, out } = todo("schema");
  assert.equal(code, 0);
  assert.deepEqual(Object.keys(out.actions), ["add", "list", "finish", "export", "setup", "schema"]);
});

test("export prints every todo, done or not", () => {
  todo("add", '{"text":"one"}');
  todo("add", '{"text":"two"}');
  todo("finish", '{"id":"t1"}');
  const { code, out } = todo("export");
  assert.equal(code, 0);
  assert.deepEqual(
    out.todos.map((item: { id: string; done: boolean }) => [item.id, item.done]),
    [["t1", true], ["t2", false]],
  );
});

test("setup prints the permission rules", () => {
  assert.deepEqual(todo("setup").out, { allow: ["Bash(todo *)"] });
});

test("an unopenable store is a JSON error without a stack trace", () => {
  const blocker = join(home, "blocker");
  writeFileSync(blocker, "");
  home = blocker;
  const { code, out, stderr } = todo("list");
  assert.equal(code, 1);
  assert.match(out.error, /^Cannot open the todo store at .*todo\.$/);
  assert.equal(stderr, "");
});
