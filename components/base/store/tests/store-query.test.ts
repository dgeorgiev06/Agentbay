import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/mode-harness.ts";
import { fieldsOf, listOf, textOf } from "../scripts/lib/json.ts";

let project: ModeProject;

const caller = "query-tests";

type Shape = {
  readonly number: number;
  readonly kind?: string;
  readonly author: string | null;
  readonly labels: readonly string[];
  readonly title?: string;
  readonly text: string;
  readonly at: string;
};

const shapes: readonly Shape[] = [
  {
    number: 1,
    author: "alice",
    labels: ["staking", "eth"],
    text: "ETH staking yields rise.",
    at: "2026-11-01T10:00:00Z",
  },
  { number: 2, author: "Bob", labels: ["solana"], text: "Firedancer runs on mainnet.", at: "2026-11-03T10:00:00Z" },
  {
    number: 3,
    author: "carol@example.com",
    labels: [],
    title: "Banks",
    text: "Custody news: two banks start pilots.",
    at: "2026-11-05T10:00:00Z",
  },
  { number: 4, author: null, labels: ["eth"], text: "An anonymous note about gas.", at: "2026-11-07T10:00:00+02:00" },
  {
    number: 5,
    kind: "repost",
    author: "alice",
    labels: ["Staking"],
    text: "Reposted: staking, again.",
    at: "2026-11-09T00:00:00Z",
  },
  { number: 6, author: "dave@other.org", labels: [], text: "Nothing to see here.", at: "2026-11-10T23:59:59Z" },
];

function itemOf(shape: Shape): Json {
  return {
    id: `fake:${String(shape.number)}`,
    kind: shape.kind ?? "post",
    source: "fake",
    at: shape.at,
    title: shape.title ?? null,
    text: shape.text,
    url: null,
    author: shape.author,
    labels: shape.labels,
    data: {},
  };
}

before(async () => {
  project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: ["store"] });
  const put = { source: "fake", kinds: ["post", "repost"], items: shapes.map(itemOf) };
  assert.equal(fieldsOf(await project.output("store.put", put, { caller })).added, 6);
});

after(async () => {
  await project.close();
});

function idsOf(output: Json): readonly string[] {
  return listOf(fieldsOf(output).items).map((item) => textOf(fieldsOf(item).id) ?? "");
}

async function queried(request: Json): Promise<readonly string[]> {
  return idsOf(await project.output("store.query", request, { caller }));
}

function sorted(ids: readonly string[]): readonly string[] {
  return [...ids].sort();
}

const all = ["fake:1", "fake:2", "fake:3", "fake:4", "fake:5", "fake:6"];

const selectorCases: readonly (readonly [string, Json, readonly number[]])[] = [
  ["an empty selector matches every item", {}, [1, 2, 3, 4, 5, 6]],
  ["authors alone, exact", { authors: ["alice"] }, [1, 5]],
  ["authors ignore case and a leading @", { authors: ["@ALICE"] }, [1, 5]],
  ["authors match a capitalised author", { authors: ["bob"] }, [2]],
  ["authors with * match a domain", { authors: ["*@example.com"] }, [3]],
  ["authors with two * match every address", { authors: ["*@*"] }, [3, 6]],
  ["an author no item has matches nothing", { authors: ["nobody"] }, []],
  ["an item with no author never matches authors", { authors: ["*"] }, [1, 2, 3, 5, 6]],
  ["labels alone", { labels: ["eth"] }, [1, 4]],
  ["labels ignore case", { labels: ["STAKING"] }, [1, 5]],
  ["any one of several labels", { labels: ["solana", "eth"] }, [1, 2, 4]],
  ["text terms alone", { text: ["staking"] }, [1, 5]],
  ["text terms look in the title too, ignoring case", { text: ["BANKS"] }, [3]],
  ["any one of several text terms", { text: ["firedancer", "gas"] }, [2, 4]],
  ["kinds alone", { kinds: ["repost"] }, [5]],
  ["another kind", { kinds: ["post"] }, [1, 2, 3, 4, 6]],
  ["since includes an item at exactly that time", { since: "2026-11-05T10:00:00Z" }, [3, 4, 5, 6]],
  ["until excludes an item at exactly that time", { until: "2026-11-05T10:00:00Z" }, [1, 2]],
  [
    "since and until compare times with their zones",
    { since: "2026-11-07T07:00:00Z", until: "2026-11-07T09:00:00Z" },
    [4],
  ],
  ["since written with a zone", { since: "2026-11-07T09:00:00+02:00" }, [4, 5, 6]],
  ["authors and labels together", { authors: ["alice"], labels: ["eth"] }, [1]],
  ["authors and kinds together", { authors: ["alice"], kinds: ["post"] }, [1]],
  ["labels, text and since together", { labels: ["eth"], text: ["gas"], since: "2026-11-06T00:00:00Z" }, [4]],
  ["fields that each match but never the same item", { authors: ["alice"], text: ["nothing"] }, []],
  ["a window that ends before the author's only item", { authors: ["bob"], until: "2026-11-02T00:00:00Z" }, []],
  ["native fields are left to the source", { native: { q: "from:alice" } }, [1, 2, 3, 4, 5, 6]],
];

test("the shared selector matcher, field by field and combined", async () => {
  assert.ok(selectorCases.length >= 20);
  for (const [name, selector, expected] of selectorCases) {
    const ids = await queried({ selector });
    assert.deepEqual(sorted(ids), sorted(expected.map((number) => `fake:${String(number)}`)), name);
  }
});

test("query returns the newest first by default, the oldest first on request, and says when more matched", async () => {
  assert.deepEqual(await queried({}), [...all].reverse());
  assert.deepEqual(await queried({ order: "oldest" }), all);
  const limited = await project.output("store.query", { selector: { limit: 2 } }, { caller });
  assert.deepEqual(idsOf(limited), ["fake:6", "fake:5"]);
  assert.equal(fieldsOf(limited).more, true);
  const exact = await project.output("store.query", { selector: { limit: 6 } }, { caller });
  assert.equal(fieldsOf(exact).more, false);
});

test("full-text search finds words in the title, text and author, all of them", async () => {
  assert.deepEqual(await queried({ search: "staking" }), ["fake:5", "fake:1"]);
  assert.deepEqual(await queried({ search: "banks pilots" }), ["fake:3"]);
  assert.deepEqual(await queried({ search: "carol" }), ["fake:3"]);
  assert.deepEqual(await queried({ search: "staking gas" }), []);
  assert.deepEqual(await queried({ search: "staking", selector: { kinds: ["post"] } }), ["fake:1"]);
});

test("punctuation, quotes and search operators in a search are plain text, never an error from the index", async () => {
  const searches: readonly (readonly [string, readonly string[]])[] = [
    ['"staking"', ["fake:5", "fake:1"]],
    ["staking!", ["fake:5", "fake:1"]],
    ['staking" OR "gas', []],
    ["firedancer OR", []],
    ["(gas", ["fake:4"]],
    ["NEAR(gas note)", []],
    ["gas*", ["fake:4"]],
    ["custody: news", ["fake:3"]],
    ["it's", []],
    ["AND", []],
    ["-gas", ["fake:4"]],
    ["ETH^2 staking", []],
  ];
  for (const [search, expected] of searches) {
    assert.deepEqual(await queried({ search }), expected, search);
  }
});

test("a search with no letters or digits is refused with a sentence that says what to give", async () => {
  for (const search of ['"', "***", "(", " - "]) {
    const reason = await project.failure("store.query", { search }, { caller });
    assert.match(reason, /has no letters or digits to look for; give at least one word/, search);
    assert.doesNotMatch(reason, /fts5|syntax error/i, search);
  }
});
