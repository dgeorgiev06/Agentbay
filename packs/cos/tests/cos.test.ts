import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const bin = join(import.meta.dirname, "..", "bin", "cos");
let home = "";

function cos(action: string, input?: object) {
  const args = input === undefined ? [action] : [action, JSON.stringify(input)];
  const run = spawnSync(bin, args, { env: { ...process.env, AGENTBAY_HOME: home }, encoding: "utf8" });
  return { status: run.status, json: JSON.parse(run.stdout), stderr: run.stderr };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cos-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

test("remembers a trimmed fact and recalls it newest first", () => {
  const saved = cos("remember", { fact: "  I rent my apartment  ", topic: "Home" });
  assert.equal(saved.status, 0);
  assert.equal(saved.json.fact, "I rent my apartment");
  assert.equal(saved.json.topic, "home");
  cos("remember", { fact: "I work on staking" });
  const { facts } = cos("recall", {}).json;
  assert.deepEqual(facts.map((f: { fact: string }) => f.fact), ["I work on staking", "I rent my apartment"]);
});

test("recall filters by topic and by query, ignoring case", () => {
  cos("remember", { fact: "I rent my apartment", topic: "home" });
  cos("remember", { fact: "I work on staking" });
  const byTopic = cos("recall", { topic: "HOME" }).json.facts;
  assert.deepEqual(byTopic.map((f: { fact: string }) => f.fact), ["I rent my apartment"]);
  const byQuery = cos("recall", { query: "STAKING" }).json.facts;
  assert.equal(byQuery.length, 1);
  assert.equal(byQuery[0].topic, null);
});

test("forgets a fact by id, once", () => {
  const { id } = cos("remember", { fact: "temporary" }).json;
  assert.deepEqual(cos("forget", { id }).json, { id, forgotten: true });
  assert.equal(cos("recall", {}).json.facts.length, 0);
  assert.equal(cos("forget", { id }).status, 1);
});

test("refuses a blank fact", () => {
  const result = cos("remember", { fact: "   " });
  assert.equal(result.status, 1);
  assert.match(result.json.error, /blank/);
});

test("refuses an unknown action", () => {
  const result = cos("explode", {});
  assert.equal(result.status, 1);
  assert.match(result.json.error, /Unknown action/);
});

test("schema lists every action", () => {
  const result = cos("schema");
  assert.equal(result.status, 0);
  assert.deepEqual(Object.keys(result.json.actions), [
    "remember",
    "recall",
    "forget",
    "export",
    "setup",
    "schema",
  ]);
});

test("export prints every fact", () => {
  cos("remember", { fact: "one" });
  cos("remember", { fact: "two", topic: "x" });
  const { status, json } = cos("export");
  assert.equal(status, 0);
  assert.deepEqual(json.facts.map((f: { fact: string }) => f.fact), ["two", "one"]);
});

test("setup prints the permission rules", () => {
  assert.deepEqual(cos("setup").json, { allow: ["Bash(cos *)"] });
});

test("an unopenable store is a JSON error without a stack trace", () => {
  const blocker = join(home, "blocker");
  writeFileSync(blocker, "");
  home = blocker;
  const { status, json, stderr } = cos("recall", {});
  assert.equal(status, 1);
  assert.match(json.error, /^Cannot open the cos store at .*cos\.$/);
  assert.equal(stderr, "");
});
