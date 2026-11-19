import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { fieldsOf, listOf, numberOf, textOf } from "../scripts/lib/json.ts";
import { bayIn, kit } from "./bay-command.ts";

const project = realpathSync(mkdtempSync(join(tmpdir(), "agentbay-feed-briefing-")));

after(() => {
  rmSync(project, { recursive: true, force: true });
});

const { ran: bay, succeeded } = bayIn(project);

function runOf(json: Json): Json {
  return fieldsOf(json).run ?? null;
}

function taskOf(json: Json): Json {
  const task = fieldsOf(runOf(json)).task;
  assert.ok(task !== undefined, JSON.stringify(json));
  return task;
}

function idsOf(selection: Json): readonly string[] {
  return listOf(fieldsOf(selection).items).map((item) => textOf(fieldsOf(item).id) ?? "");
}

function draftFor(selection: Json, ids: readonly string[]): Json {
  const theme = {
    title: "What the week's posts said",
    summary: "Several accounts posted about staking at banks, custodians and validator clients this week.",
    cites: ids.slice(0, 3),
  };
  return {
    period: fieldsOf(selection).period ?? null,
    selectorChanged: fieldsOf(selection).selectorChanged ?? null,
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
  writeFileSync(join(project, "agentbay.config.yaml"), `${JSON.stringify(config, null, 2)}\n`);
  const checked = succeeded(["check"]);
  assert.equal(fieldsOf(checked).errors, 0, JSON.stringify(checked));
  assert.equal(fieldsOf(checked).warnings, 0, JSON.stringify(checked));
  succeeded(["build"]);
  for (const skill of ["digest", "ask"]) {
    const agent = join(project, ".claude", "agents", `agentbay-feed-briefing-${skill}.md`);
    assert.ok(existsSync(agent), agent);
    const text = readFileSync(agent, "utf8");
    assert.ok(text.includes(join(kit, "components", "modes", "feed-briefing", "skills", skill, "SKILL.md")), text);
    assert.ok(text.includes("mcp__agentbay__call_action"), text);
  }
}

function hookSawSubmit(skill: string, token: string, output: Json): void {
  const settings = JSON.stringify(JSON.parse(readFileSync(join(project, ".claude", "settings.json"), "utf8")));
  const command = /"command":"(node [^"]+)"/.exec(settings)?.[1];
  assert.ok(command !== undefined, settings);
  const payload = {
    cwd: project,
    agent_id: "agent-1",
    agent_type: `agentbay-feed-briefing-${skill}`,
    tool_name: "mcp__agentbay__submit",
    tool_input: { token, output },
  };
  const ran = spawnSync("sh", ["-c", command], { input: JSON.stringify(payload), encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stdout);
}

function synced(): void {
  const run = runOf(succeeded(["call", "feed-briefing.sync", "{}"]));
  assert.equal(fieldsOf(run).status, "done", JSON.stringify(run));
  const counts = fieldsOf(fieldsOf(run).output ?? null);
  assert.equal(counts.fetched, 30);
  assert.equal(counts.added, 21);
  assert.deepEqual(counts.cost, { items: 30, usd: 0.03 });
}

function storeReadThroughTheTool(token: string, id: string): void {
  const input = { ids: [id, "fake:0"] };
  const read = succeeded([
    "call",
    "--tool",
    "call_action",
    JSON.stringify({ token, action: "items-store.get", input }),
  ]);
  const got = fieldsOf(fieldsOf(fieldsOf(read).result ?? null).output ?? null);
  assert.deepEqual(got.missing, ["fake:0"]);
  assert.equal(textOf(fieldsOf(listOf(got.items)[0] ?? null).id), id);
  const writing = JSON.stringify({ token, action: "items-store.put", input: {} });
  const refused = bay(["call", "--tool", "call_action", writing]);
  assert.equal(refused.status, 1, refused.output);
}

function digested(): void {
  const task = fieldsOf(taskOf(succeeded(["call", "feed-briefing.digest", "{}"])));
  assert.equal(task.agent, "agentbay-feed-briefing-digest");
  const token = textOf(task.token) ?? "";
  const selection = task.input ?? null;
  const ids = idsOf(selection);
  assert.equal(ids.length, 21);
  storeReadThroughTheTool(token, ids[0] ?? "");
  const output = draftFor(selection, ids);
  hookSawSubmit("digest", token, output);
  const submitted = succeeded(["call", "--tool", "submit", JSON.stringify({ token, output })]);
  assert.equal(fieldsOf(fieldsOf(submitted).result ?? null).accepted, true, JSON.stringify(submitted));
  const finished = fieldsOf(runOf(succeeded(["runs", textOf(task.runId) ?? ""])));
  assert.equal(finished.status, "done", JSON.stringify(finished));
  assert.equal(numberOf(fieldsOf(finished.output ?? null).cited), 3);
}

function workflowRunToTheApproval(): void {
  const task = fieldsOf(taskOf(succeeded(["call", "--workflow", "feed-briefing:workflows/daily.yaml"])));
  const selection = task.input ?? null;
  const token = textOf(task.token) ?? "";
  const output = draftFor(selection, idsOf(selection));
  hookSawSubmit("digest", token, output);
  succeeded(["call", "--tool", "submit", JSON.stringify({ token, output })]);
  const approval = fieldsOf(runOf(succeeded(["runs", textOf(task.runId) ?? ""])));
  assert.equal(approval.status, "waiting", JSON.stringify(approval));
  const waiting = fieldsOf(approval.waiting ?? null);
  assert.equal(waiting.reason, "approval", JSON.stringify(approval));
  assert.match(textOf(waiting.hash) ?? "", /^[0-9a-f]{64}$/);
  assert.equal(numberOf(fieldsOf(waiting.content ?? null).cited), 3);
}

test("a fresh project with this kit checks, builds, syncs, digests through a skill and runs the daily workflow", () => {
  checkedAndBuilt();
  synced();
  digested();
  workflowRunToTheApproval();
});
