import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const entry = join(import.meta.dirname, "..", "bin", "todo");
let dataDir = "";

function todo(...args: string[]) {
  const env = { ...process.env, AGENTBAY_DATA_DIR: dataDir };
  delete env.CLAUDE_PLUGIN_DATA;
  const run = spawnSync(entry, args, { env, encoding: "utf8" });
  return { code: run.status, out: JSON.parse(run.stdout) };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "todo-test-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
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
  assert.deepEqual(Object.keys(out.actions), ["add", "list", "finish", "schema"]);
});
