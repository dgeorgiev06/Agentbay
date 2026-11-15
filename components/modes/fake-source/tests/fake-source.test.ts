import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/mode-harness.ts";
import { fixturePosts } from "../scripts/lib/posts.ts";

let project: ModeProject;

const baseDate = "2026-11-15T12:00:00.000Z";

before(async () => {
  project = await openModeProject({
    bindings: {},
    adapter: "claude-code",
    modes: ["fake-source"],
    settings: { "fake-source": { baseDate, pageSize: 10, costPerItemUsd: 0.002 } },
  });
});

after(async () => {
  await project.close();
});

type Fields = { readonly [key: string]: Json };

function isFields(value: Json | undefined): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function fieldOf(value: Json | undefined, name: string): Json {
  return isFields(value) ? (value[name] ?? null) : null;
}

function listOf(value: Json): readonly Json[] {
  return isList(value) ? value : [];
}

type Fetched = {
  readonly output: Json;
  readonly ids: readonly string[];
  readonly items: readonly Json[];
};

async function fetched(selector: Json, cursor: Json = null): Promise<Fetched> {
  const output = await project.output("fake-source.fetch", { selector, cursor });
  const items = listOf(fieldOf(output, "items"));
  const ids = items.map((item) => fieldOf(item, "id")).map((id) => (typeof id === "string" ? id : ""));
  return { output, items, ids };
}

test("the fixture has about thirty varied posts spread over the two weeks before the base date", () => {
  assert.equal(fixturePosts.length, 30);
  assert.ok(new Set(fixturePosts.map((post) => post.author)).size >= 6);
  assert.ok(fixturePosts.some((post) => post.linked) && fixturePosts.some((post) => !post.linked));
  assert.ok(fixturePosts.every((post) => post.hoursBefore > 0 && post.hoursBefore < 14 * 24));
});

test("fetch pages through every post oldest first with a cursor, and reports each page's cost", async () => {
  const seen: string[] = [];
  let cursor: Json = null;
  for (let page = 1; page <= 3; page += 1) {
    const result = await fetched({}, cursor);
    assert.equal(result.ids.length, 10);
    assert.equal(fieldOf(result.output, "more"), page < 3);
    assert.deepEqual(fieldOf(result.output, "cost"), { items: 10, usd: 0.02 });
    seen.push(...result.ids);
    cursor = fieldOf(result.output, "cursor");
  }
  assert.equal(new Set(seen).size, 30);
  const times = seen.map((id) => fixturePosts.find((post) => `fake:${String(post.number)}` === id)?.hoursBefore ?? 0);
  assert.deepEqual(
    times,
    [...times].sort((first, second) => second - first),
  );
  const after = await fetched({}, cursor);
  assert.deepEqual(after.ids, []);
  assert.equal(fieldOf(after.output, "more"), false);
  assert.equal(fieldOf(after.output, "cursor"), cursor);
  assert.deepEqual(fieldOf(after.output, "cost"), { items: 0, usd: 0 });
});

test("the cost of a page is charged to the run's budget", async () => {
  const run = await project.run("fake-source.fetch", { selector: { limit: 3 }, cursor: null });
  assert.equal(run.spent.items, 3);
  assert.equal(run.spent.usd, 0.006);
});

test("fetch applies authors, since, until and limit itself and leaves the other fields to the store", async () => {
  const vitalik = await fetched({ authors: ["@VITALIK"] });
  assert.deepEqual(vitalik.ids, ["fake:1003", "fake:1013", "fake:1022", "fake:1030"]);
  const window = await fetched({ since: "2026-11-14T00:00:00Z", until: "2026-11-15T10:00:00Z" });
  assert.deepEqual(window.ids, ["fake:1026", "fake:1027", "fake:1028", "fake:1029"]);
  const limited = await fetched({ limit: 2 });
  assert.deepEqual(limited.ids, ["fake:1001", "fake:1002"]);
  const labelled = await fetched({ labels: ["regulation"], text: ["nothing like this"], limit: 4 });
  assert.equal(labelled.ids.length, 4);
  const pattern = await fetched({ authors: ["vit*"], limit: 3 });
  assert.deepEqual(pattern.ids, ["fake:1001", "fake:1002", "fake:1003"]);
});

test("every post is a valid item: its source, kind, time and url follow the base date", async () => {
  const result = await fetched({ authors: ["vitalik", "lido"], limit: 3 });
  assert.deepEqual(result.items[0], {
    id: "fake:1002",
    kind: "post",
    source: "fake",
    at: "2026-11-02T06:00:00.000Z",
    title: null,
    text: "The withdrawal queue cleared in under a day for the third week running.",
    url: "https://fake.example/lido/status/1002",
    author: "lido",
    labels: ["eth", "staking"],
    data: { likes: 120 },
  });
  assert.equal(fieldOf(result.items[1], "url"), null);
});

test("describe names the source, its kinds, the selector fields it applies itself and what a page costs", async () => {
  assert.deepEqual(await project.output("fake-source.describe", {}), {
    source: "fake",
    kinds: ["post"],
    nativeFields: ["authors", "since", "until", "limit"],
    pageCostUsd: 0.02,
  });
});

test("a cursor the fake did not make is refused with a sentence that says how to start again", async () => {
  const reason = await project.failure("fake-source.fetch", { selector: {}, cursor: "page=2" });
  assert.match(reason, /was not made by fake-source; fetch again with cursor null/);
});
