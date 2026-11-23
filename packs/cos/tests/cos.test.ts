import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const bin = join(import.meta.dirname, "..", "bin", "cos");

let dataDir: string;

function cos(action: string, input?: object) {
  const args = input === undefined ? [action] : [action, JSON.stringify(input)];
  const env = { ...process.env, AGENTBAY_DATA_DIR: dataDir };
  delete env.CLAUDE_PLUGIN_DATA;
  const result = spawnSync(bin, args, { env, encoding: "utf8" });
  return { status: result.status, json: JSON.parse(result.stdout) };
}

describe("cos", () => {
  before(() => {
    dataDir = mkdtempSync(join(tmpdir(), "cos-test-"));
  });

  after(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("remembers a trimmed fact and recalls it newest first", () => {
    const saved = cos("remember", { fact: "  I rent my apartment  ", topic: "Home" });
    assert.equal(saved.status, 0);
    assert.equal(saved.json.fact, "I rent my apartment");
    assert.equal(saved.json.topic, "home");
    cos("remember", { fact: "I work on staking" });
    const { facts } = cos("recall", {}).json;
    assert.equal(facts.length, 2);
    assert.equal(facts[0].fact, "I work on staking");
  });

  it("filters by topic", () => {
    const { facts } = cos("recall", { topic: "HOME" }).json;
    assert.deepEqual(facts.map((f: { fact: string }) => f.fact), ["I rent my apartment"]);
  });

  it("filters by query, ignoring case", () => {
    const { facts } = cos("recall", { query: "STAKING" }).json;
    assert.equal(facts.length, 1);
    assert.equal(facts[0].topic, null);
  });

  it("forgets a fact by id", () => {
    const { id } = cos("remember", { fact: "temporary" }).json;
    assert.deepEqual(cos("forget", { id }).json, { id, forgotten: true });
    const { facts } = cos("recall", { query: "temporary" }).json;
    assert.equal(facts.length, 0);
    assert.equal(cos("forget", { id }).status, 1);
  });

  it("refuses a blank fact", () => {
    const result = cos("remember", { fact: "   " });
    assert.equal(result.status, 1);
    assert.match(result.json.error, /blank/);
  });

  it("refuses an unknown action", () => {
    const result = cos("explode", {});
    assert.equal(result.status, 1);
    assert.match(result.json.error, /Unknown action/);
  });

  it("prints the schema", () => {
    const result = cos("schema");
    assert.equal(result.status, 0);
    assert.deepEqual(Object.keys(result.json), ["remember", "recall", "forget"]);
  });
});
