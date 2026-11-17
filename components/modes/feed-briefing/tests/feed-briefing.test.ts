import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { fieldsOf, listOf, textOf } from "../scripts/lib/json.ts";

const baseDate = "2026-11-15T12:00:00.000Z";

type Options = {
  readonly usd?: number;
  readonly selector?: Readonly<Record<string, Json>>;
  readonly maxItems?: number;
};

function configOf(options: Options = {}): Parameters<typeof openModeProject>[0] {
  return {
    bindings: { "items-source": "fake-source", "items-store": "store" },
    adapter: "claude-code",
    modes: ["feed-briefing"],
    settings: {
      "feed-briefing": { selector: options.selector ?? {}, lookback: "14d", maxItems: options.maxItems ?? 100 },
      "fake-source": { baseDate, pageSize: 10, costPerItemUsd: 0.001 },
    },
    ...(options.usd === undefined ? {} : { budget: { usd: options.usd } }),
  };
}

async function withBriefing(options: Options, body: (project: ModeProject) => Promise<void>): Promise<void> {
  const project = await openModeProject(configOf(options));
  try {
    await body(project);
  } finally {
    await project.close();
  }
}

const since = "2026-11-01T00:00:00Z";

async function briefingRows(project: ModeProject, sql: string): Promise<readonly Json[]> {
  const rows = await project.partition("store", "feed-briefing").query(sql);
  assert.ok(rows.ok, rows.ok ? "" : rows.message);
  return rows.value;
}

async function storedCount(project: ModeProject): Promise<Json> {
  const [row] = await briefingRows(project, "select count(*) as count from items");
  return fieldsOf(row ?? null).count ?? null;
}

async function spentByMonth(project: ModeProject): Promise<readonly Json[]> {
  return briefingRows(project, "select month, items, usd from spend_by_month where source = 'fake'");
}

type WaitingSkill = {
  readonly token: string;
  readonly input: Json;
  readonly round: number;
  readonly feedback: readonly string[];
};

function waitingSkillOf(run: Awaited<ReturnType<ModeProject["run"]>>): WaitingSkill {
  if (run.state.status !== "waiting" || run.state.waiting.reason !== "skill") {
    assert.fail(`expected the run to wait for a skill, got ${JSON.stringify(run.state)}`);
  }
  const task = run.state.waiting.task;
  assert.ok(task.token !== undefined, "the task carries no token");
  return {
    token: task.token,
    input: task.input,
    round: task.round,
    feedback: task.feedback,
  };
}

async function submitted(project: ModeProject, waiting: WaitingSkill, output: Json): ReturnType<ModeProject["run"]> {
  return project.answer(waiting.token, output);
}

function outputOf(run: Awaited<ReturnType<ModeProject["run"]>>): Json {
  if (run.state.status !== "done") {
    assert.fail(`expected the run to be done, got ${JSON.stringify(run.state)}`);
  }
  return run.state.output;
}

function itemIdsOf(selection: Json): readonly string[] {
  return listOf(fieldsOf(selection).items).map((item) => textOf(fieldsOf(item).id) ?? "");
}

function draftFor(selection: Json, themes: Json): Json {
  const fields = fieldsOf(selection);
  return { period: fields.period ?? null, selectorChanged: fields.selectorChanged ?? null, themes, notes: null };
}

const goodThemes = [
  {
    title: "Banks bring staking into production",
    summary: "Custody news reports EU bank pilots, and a research note says three banks now stake in production.",
    cites: ["fake:1008", "fake:1021"],
  },
  {
    title: "Solana staking grows",
    summary: "Firedancer runs on a share of stake and participation reached a new high.",
    cites: ["fake:1010", "fake:1029"],
  },
];

test("sync fills the store from the fake source page by page and reports the cost", async () => {
  await withBriefing({}, async (project) => {
    const run = await project.run("feed-briefing.sync", { since });
    assert.deepEqual(outputOf(run), {
      source: "fake",
      pages: 3,
      fetched: 30,
      added: 30,
      updated: 0,
      skipped: 0,
      cost: { items: 30, usd: 0.03 },
      cursor: "2026-11-15T10:00:00.000Z|fake:1030",
      more: false,
      selectorChanged: false,
    });
    assert.equal(run.spent.usd, 0.03);
    assert.equal(await storedCount(project), 30);
    const month = new Date().toISOString().slice(0, 7);
    assert.deepEqual(await spentByMonth(project), [{ month, items: 30, usd: 0.03 }]);
  });
});

test("a second sync continues from the saved cursor and adds nothing new", async () => {
  await withBriefing({}, async (project) => {
    await project.output("feed-briefing.sync", { since });
    const again = fieldsOf(await project.output("feed-briefing.sync", { since }));
    assert.deepEqual([again.pages, again.fetched, again.added, again.updated], [1, 0, 0, 0]);
    assert.deepEqual(again.cost, { items: 0, usd: 0 });
    assert.equal(await storedCount(project), 30);
  });
});

test("sync stops at maxItems and the next sync goes on where it stopped", async () => {
  await withBriefing({ maxItems: 12 }, async (project) => {
    const first = fieldsOf(await project.output("feed-briefing.sync", { since }));
    assert.deepEqual([first.pages, first.fetched, first.more], [2, 12, true]);
    const second = fieldsOf(await project.output("feed-briefing.sync", { since }));
    assert.deepEqual([second.fetched, second.added, second.more], [12, 12, true]);
    assert.equal(await storedCount(project), 24);
  });
});

test("sync applies the selector: the source's native fields, then the store's matcher for the rest", async () => {
  await withBriefing({ selector: { authors: ["vitalik", "lido"], text: ["staking"] } }, async (project) => {
    const output = fieldsOf(await project.output("feed-briefing.sync", { since }));
    assert.deepEqual([output.fetched, output.added, output.skipped], [8, 4, 4]);
    assert.deepEqual(output.cost, { items: 8, usd: 0.008 });
    const stored = await briefingRows(project, "select id from items order by at_ms, id");
    const ids = stored.map((item) => textOf(fieldsOf(item).id) ?? "");
    assert.deepEqual(ids, ["fake:1003", "fake:1011", "fake:1022", "fake:1030"]);
  });
});

test("with a budget smaller than one page the run waits for budget and stores no part of the page", async () => {
  await withBriefing({ usd: 0.005 }, async (project) => {
    const run = await project.run("feed-briefing.sync", { since });
    if (run.state.status !== "waiting") {
      assert.fail(`expected the run to wait, got ${JSON.stringify(run.state)}`);
    }
    assert.equal(run.state.waiting.reason, "budget");
    assert.equal(await storedCount(project), 0);
    const resumed = await project.extend(run.id, { usd: 1 });
    assert.equal(fieldsOf(outputOf(resumed)).added, 30);
    assert.equal(resumed.spent.usd, 0.03);
    assert.equal(await storedCount(project), 30);
    const spent = await spentByMonth(project);
    assert.equal(fieldsOf(spent[0] ?? null).usd, 0.03);
  });
});

test("digest waits for the skill with a task whose input is the selected items of the window", async () => {
  await withBriefing({ maxItems: 50 }, async (project) => {
    await project.output("feed-briefing.sync", { since });
    const waiting = waitingSkillOf(await project.run("feed-briefing.digest", { until: "2026-11-10T00:00:00Z" }));
    assert.equal(waiting.round, 1);
    const selection = fieldsOf(waiting.input);
    assert.deepEqual(selection.period, { since: "2026-10-27T00:00:00.000Z", until: "2026-11-10T00:00:00.000Z" });
    assert.equal(selection.selectorChanged, false);
    const ids = itemIdsOf(waiting.input);
    assert.equal(ids.length, 15);
    assert.equal(ids[0], "fake:1001");
    const first = fieldsOf(listOf(selection.items)[0]);
    assert.deepEqual(Object.keys(first).sort(), ["at", "author", "excerpt", "id", "labels", "url"]);
    assert.equal(first.url, "https://fake.example/custody_news/status/1001");
  });
});

test("a digest citing an id it was not given fails the check, with feedback naming the id", async () => {
  await withBriefing({}, async (project) => {
    await project.output("feed-briefing.sync", { since });
    const waiting = waitingSkillOf(await project.run("feed-briefing.digest", { until: baseDate }));
    const bad = [{ title: "Made up", summary: "A theme that rests on a post nobody gave.", cites: ["fake:9999"] }];
    const back = waitingSkillOf(await submitted(project, waiting, draftFor(waiting.input, bad)));
    assert.equal(back.round, 2);
    assert.equal(back.feedback.length, 1);
    assert.match(back.feedback[0] ?? "", /cites fake:9999, which is not one of the items you were given/);
    const done = await submitted(project, back, draftFor(back.input, goodThemes));
    const digest = fieldsOf(outputOf(done));
    assert.equal(digest.cited, 4);
    const sources = listOf(fieldsOf(listOf(digest.themes)[0]).sources);
    assert.deepEqual(sources[0], {
      id: "fake:1008",
      author: "custody_news",
      at: "2026-11-06T06:00:00.000Z",
      url: "https://fake.example/custody_news/status/1008",
    });
  });
});

test("the check refuses no citations, long summaries, copied text and changed copied fields", async () => {
  await withBriefing({}, async (project) => {
    await project.output("feed-briefing.sync", { since });
    const waiting = waitingSkillOf(await project.run("feed-briefing.digest", { until: baseDate }));
    const copied = "A large custodian adds same-day unstaking for ETH, ending a week-long wait.";
    const themes = [
      { title: "No sources here", summary: "This theme cites nothing at all, so it rests on nothing.", cites: [] },
      { title: "Copied", summary: `Reported: ${copied}`, cites: ["fake:1024"] },
      { title: "Too long", summary: Array.from({ length: 61 }, () => "word").join(" "), cites: ["fake:1001"] },
    ];
    const draft = { ...fieldsOf(draftFor(waiting.input, themes)), selectorChanged: true };
    await project.answerRefusal(waiting.token, draft);
    const withOneCite = themes.map((theme, index) => (index === 0 ? { ...theme, cites: ["fake:1002"] } : theme));
    const back = waitingSkillOf(
      await submitted(project, waiting, { ...draft, themes: withOneCite, notes: "word ".repeat(81) }),
    );
    const feedback = back.feedback.join(" ");
    assert.match(feedback, /Theme 2 \("Copied"\) copies the text of fake:1024/);
    assert.match(feedback, /The summary of Theme 3 \("Too long"\) has 61 words; use at most 60/);
    assert.match(feedback, /The notes has 81 words; use at most 80/);
    assert.match(feedback, /Copy selectorChanged exactly from the input: false/);
  });
});

test("three bad rounds fail the run", async () => {
  await withBriefing({}, async (project) => {
    await project.output("feed-briefing.sync", { since });
    let waiting = waitingSkillOf(await project.run("feed-briefing.digest", { until: baseDate }));
    const bad = [{ title: "Made up", summary: "A theme that rests on a post nobody gave.", cites: ["fake:4242"] }];
    for (const round of [1, 2]) {
      assert.equal(waiting.round, round);
      waiting = waitingSkillOf(await submitted(project, waiting, draftFor(waiting.input, bad)));
    }
    const failed = await submitted(project, waiting, draftFor(waiting.input, bad));
    if (failed.state.status !== "failed") {
      assert.fail(`expected the run to fail, got ${JSON.stringify(failed.state)}`);
    }
    assert.match(failed.state.reason, /round 3, the last round.*fake:4242/);
  });
});

test("digest says when the configured selector differs from the one the store was last synced with", async () => {
  const first = await openModeProject(configOf({ selector: { labels: ["custody"] } }));
  await first.output("feed-briefing.sync", { since });
  const project = await first.reopen(configOf({ selector: { labels: ["solana"] } }));
  try {
    const stale = waitingSkillOf(await project.run("feed-briefing.digest", { until: baseDate }));
    assert.equal(fieldsOf(stale.input).selectorChanged, true);
    assert.deepEqual(itemIdsOf(stale.input), ["fake:1001"]);
    const synced = fieldsOf(await project.output("feed-briefing.sync", { since }));
    assert.deepEqual([synced.selectorChanged, synced.fetched, synced.added, synced.updated], [true, 30, 5, 1]);
    const fresh = waitingSkillOf(await project.run("feed-briefing.digest", { until: baseDate }));
    assert.equal(fieldsOf(fresh.input).selectorChanged, false);
    assert.equal(itemIdsOf(fresh.input).length, 6);
  } finally {
    await project.close();
  }
});

test("ask answers from the store and its check refuses an id the store does not hold", async () => {
  await withBriefing({}, async (project) => {
    await project.output("feed-briefing.sync", { since });
    const waiting = waitingSkillOf(
      await project.run("feed-briefing.ask", { question: "Who added same-day unstaking?" }),
    );
    assert.deepEqual(waiting.input, { question: "Who added same-day unstaking?" });
    const back = waitingSkillOf(
      await submitted(project, waiting, { answer: "Someone did (fake:5000).", cites: ["fake:5000"] }),
    );
    assert.match(back.feedback.join(" "), /cites fake:5000, which is not in the store/);
    const answer = { answer: "A large custodian added same-day ETH unstaking (fake:1024).", cites: ["fake:1024"] };
    const done = await submitted(project, back, answer);
    assert.deepEqual(done.state, { status: "done", output: answer });
  });
});

test("the daily workflow syncs, waits for the digest skill, then for approval of the digest", async () => {
  await withBriefing({}, async (project) => {
    const started = await project.runWorkflow("feed-briefing", "workflows/daily.yaml", {});
    const waiting = waitingSkillOf(started);
    const selection = waiting.input;
    const ids = new Set(itemIdsOf(selection));
    const themes = goodThemes.filter((theme) => theme.cites.every((id) => ids.has(id)));
    const draft = draftFor(selection, themes.length > 0 ? themes : []);
    const approval = await submitted(project, waiting, draft);
    if (approval.state.status !== "waiting" || approval.state.waiting.reason !== "approval") {
      assert.fail(`expected an approval, got ${JSON.stringify(approval.state)}`);
    }
    const shown = approval.state.waiting;
    assert.match(shown.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual([...Object.keys(fieldsOf(shown.content))].sort(), [
      "cited",
      "notes",
      "period",
      "selectorChanged",
      "themes",
    ]);
    const decision = { stepKey: shown.stepKey, hash: shown.hash, verdict: "approve" as const, by: "the owner" };
    const done = await project.approve(approval.id, decision);
    assert.deepEqual(done.state, { status: "done", output: shown.content });
  });
});

test("sync and digest take now from the kernel's clock: the lookback window ends at the clock's time", async () => {
  const later = await openModeProject(configOf(), { startAt: "2027-01-01T00:00:00.000Z" });
  try {
    const nothing = fieldsOf(await later.output("feed-briefing.sync", {}));
    assert.deepEqual([nothing.fetched, nothing.added], [0, 0]);
    later.setTime("2026-11-16T00:00:00.000Z");
    const recent = fieldsOf(await later.output("feed-briefing.sync", {}));
    assert.deepEqual([recent.fetched, recent.added], [29, 29]);
    const waiting = waitingSkillOf(await later.run("feed-briefing.digest", {}));
    const period = fieldsOf(waiting.input).period;
    assert.deepEqual(period, { since: "2026-11-02T00:00:00.000Z", until: "2026-11-16T00:00:00.000Z" });
  } finally {
    await later.close();
  }
});
