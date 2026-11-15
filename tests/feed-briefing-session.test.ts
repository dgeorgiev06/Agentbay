import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, numberField, parseJson, textField } from "../bay/json.ts";
import { listOf } from "./cli-fixture.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { kit } from "./project-fixture.ts";

const project = realpathSync(mkdtempSync(join(tmpdir(), "agentbay-feed-briefing-")));

after(() => {
  rmSync(project, { recursive: true, force: true });
});

type Ran = { readonly status: number | null; readonly json: Json; readonly output: string };

function bay(argv: readonly string[]): Ran {
  const result = spawnSync(process.execPath, [join(kit, "bay", "cli.ts"), ...argv, "--json"], {
    cwd: project,
    env: testEnvironment,
    input: "",
    encoding: "utf8",
  });
  const lines = result.stdout.split("\n").filter((line) => line !== "");
  assert.equal(lines.length, 1, `bay ${argv.join(" ")} printed:\n${result.stdout}\n${result.stderr}`);
  return { status: result.status, json: parseJson(lines[0] ?? ""), output: result.stdout };
}

function succeeded(argv: readonly string[]): Json {
  const ran = bay(argv);
  assert.equal(ran.status, 0, `bay ${argv.join(" ")}: ${ran.output}`);
  return ran.json;
}

function runOf(json: Json): Json {
  return fieldOf(json, "run") ?? null;
}

function taskOf(json: Json): Json {
  const task = fieldOf(runOf(json), "task");
  assert.ok(task !== undefined, JSON.stringify(json));
  return task;
}

function idsOf(selection: Json): readonly string[] {
  return listOf(fieldOf(selection, "items")).map((item) => textField(item, "id") ?? "");
}

function draftFor(selection: Json, ids: readonly string[]): Json {
  const theme = {
    title: "What the week's posts said",
    summary: "Several accounts posted about staking at banks, custodians and validator clients this week.",
    cites: ids.slice(0, 3),
  };
  return {
    period: fieldOf(selection, "period") ?? null,
    selectorChanged: fieldOf(selection, "selectorChanged") ?? null,
    themes: ids.length === 0 ? [] : [theme],
    notes: ids.length === 0 ? "The window holds no posts." : null,
  };
}

const baseDate = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();

const config = {
  modes: ["feed-briefing"],
  bindings: { "items-source": "fake-source", "items-store": "store" },
  adapter: "claude-code",
  settings: {
    "feed-briefing": { selector: { labels: ["staking", "custody"] }, lookback: "15d", maxItems: 40 },
    "fake-source": { baseDate, pageSize: 10, costPerItemUsd: 0.001 },
  },
};

function checkedAndBuilt(): void {
  execFileSync("git", ["init", "-q"], { cwd: project });
  writeFileSync(join(project, "agentbay.config.yaml"), stringify(config));
  const checked = succeeded(["check"]);
  assert.equal(numberField(checked, "errors"), 0, JSON.stringify(checked));
  assert.equal(numberField(checked, "warnings"), 0, JSON.stringify(checked));
  succeeded(["build"]);
  for (const skill of ["digest", "ask"]) {
    const agent = join(project, ".claude", "agents", `agentbay-feed-briefing-${skill}.md`);
    assert.ok(existsSync(agent), agent);
    const text = readFileSync(agent, "utf8");
    assert.ok(text.includes(join(kit, "components", "modes", "feed-briefing", "skills", skill, "SKILL.md")), text);
    assert.ok(text.includes("mcp__agentbay__call_action"), text);
  }
}

function synced(): void {
  const run = runOf(succeeded(["call", "feed-briefing.sync", "{}"]));
  assert.equal(textField(run, "status"), "done", JSON.stringify(run));
  const counts = fieldOf(run, "output") ?? null;
  assert.equal(numberField(counts, "fetched"), 30);
  assert.equal(numberField(counts, "added"), 21);
  assert.deepEqual(fieldOf(counts, "cost"), { items: 30, usd: 0.03 });
}

function storeReadThroughTheTool(token: string, id: string): void {
  const input = { ids: [id, "fake:0"] };
  const read = succeeded([
    "call",
    "--tool",
    "call_action",
    JSON.stringify({ token, action: "items-store.get", input }),
  ]);
  const got = fieldOf(fieldOf(read, "result") ?? null, "output") ?? null;
  assert.deepEqual(fieldOf(got, "missing"), ["fake:0"]);
  assert.equal(textField(listOf(fieldOf(got, "items"))[0] ?? null, "id"), id);
  const writing = JSON.stringify({ token, action: "items-store.put", input: {} });
  const refused = bay(["call", "--tool", "call_action", writing]);
  assert.equal(refused.status, 1, refused.output);
}

function digested(): void {
  const task = taskOf(succeeded(["call", "feed-briefing.digest", "{}"]));
  assert.equal(textField(task, "agent"), "agentbay-feed-briefing-digest");
  const token = textField(task, "token") ?? "";
  const selection = fieldOf(task, "input") ?? null;
  const ids = idsOf(selection);
  assert.equal(ids.length, 21);
  storeReadThroughTheTool(token, ids[0] ?? "");
  const submitted = succeeded([
    "call",
    "--tool",
    "submit",
    JSON.stringify({ token, output: draftFor(selection, ids) }),
  ]);
  assert.equal(fieldOf(fieldOf(submitted, "result") ?? null, "accepted"), true, JSON.stringify(submitted));
  const finished = runOf(succeeded(["runs", textField(task, "runId") ?? ""]));
  assert.equal(textField(finished, "status"), "done", JSON.stringify(finished));
  assert.equal(numberField(fieldOf(finished, "output") ?? null, "cited"), 3);
}

function workflowRunToTheApproval(): void {
  const task = taskOf(succeeded(["call", "--workflow", "feed-briefing:workflows/daily.yaml"]));
  const selection = fieldOf(task, "input") ?? null;
  const token = textField(task, "token") ?? "";
  succeeded(["call", "--tool", "submit", JSON.stringify({ token, output: draftFor(selection, idsOf(selection)) })]);
  const approval = runOf(succeeded(["runs", textField(task, "runId") ?? ""]));
  assert.equal(textField(approval, "status"), "waiting", JSON.stringify(approval));
  const waiting = fieldOf(approval, "waiting") ?? null;
  assert.equal(textField(waiting, "reason"), "approval", JSON.stringify(approval));
  assert.match(textField(waiting, "hash") ?? "", /^[0-9a-f]{64}$/);
  assert.equal(numberField(fieldOf(waiting, "content") ?? null, "cited"), 3);
}

test("a fresh project with this kit checks, builds, syncs, digests through a skill and runs the daily workflow", () => {
  checkedAndBuilt();
  synced();
  digested();
  workflowRunToTheApproval();
});
