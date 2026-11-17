import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openModeProject, type ModeProject } from "../../../../../tests/test-toolbox.ts";

export type ItemsStoreUnderTest = {
  readonly mode: string;
};

type Value = Awaited<ReturnType<ModeProject["output"]>>;

type Fields = { readonly [key: string]: Value };

type ItemFields = {
  readonly id?: string;
  readonly kind?: string;
  readonly source?: string;
  readonly at?: string;
  readonly title?: string | null;
  readonly text?: string;
  readonly author?: string | null;
  readonly labels?: readonly string[];
};

type Case = {
  readonly name: string;
  readonly run: (store: Store) => Promise<void>;
};

type Store = {
  readonly output: (action: string, input: Value) => Promise<Value>;
  readonly failure: (action: string, input: Value) => Promise<string>;
  readonly refusal: (action: string, input: Value) => Promise<string>;
  readonly as: (caller: string) => Store;
};

const startAt = "2026-11-15T12:00:00.000Z";

const month = "2026-11";

const interfaceName = "items-store";

function isFields(value: Value): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: Value): value is readonly Value[] {
  return Array.isArray(value);
}

function field(value: Value, name: string): Value {
  return isFields(value) ? (value[name] ?? null) : null;
}

function listOf(value: Value): readonly Value[] {
  return isList(value) ? value : [];
}

function idsOf(output: Value): readonly Value[] {
  return listOf(field(output, "items")).map((item) => field(item, "id"));
}

function reasonsGiven(output: Value): readonly (readonly [Value, boolean])[] {
  return listOf(field(output, "skipped")).map((entry) => {
    const reason = field(entry, "reason");
    return [field(entry, "id"), typeof reason === "string" && reason.length > 0];
  });
}

function post(number: number, fields: ItemFields = {}): Fields {
  return {
    id: `fake:${String(number)}`,
    kind: "post",
    source: "fake",
    at: `2026-11-0${String((number % 9) + 1)}T10:00:00Z`,
    title: null,
    text: `Post number ${String(number)} about staking.`,
    url: `https://fake.example/posts/${String(number)}`,
    author: "alice",
    labels: [],
    data: { likes: number },
    ...fields,
  };
}

function note(name: string, kind = "note"): Fields {
  return {
    id: `local:${name}`,
    kind,
    source: "local",
    at: "2026-11-02T09:00:00Z",
    title: `Note ${name}`,
    text: "Written by the owner.",
    url: null,
    author: null,
    labels: [],
    data: {},
  };
}

function page(items: readonly Value[], extra: Fields = {}): Fields {
  return { source: "fake", kinds: ["post"], items, ...extra };
}

function notes(items: readonly Value[]): Fields {
  return { source: "local", kinds: ["note"], items };
}

const queried: readonly Fields[] = [
  post(1, {
    author: "alice",
    labels: ["staking", "eth"],
    text: "ETH staking yields rise.",
    at: "2026-11-01T10:00:00Z",
  }),
  post(2, { author: "Bob", labels: ["solana"], text: "Firedancer runs on mainnet.", at: "2026-11-03T10:00:00Z" }),
  post(3, {
    author: "carol@example.com",
    title: "Banks",
    text: "Custody news: two banks start pilots.",
    at: "2026-11-05T10:00:00Z",
  }),
  post(4, { author: null, labels: ["eth"], text: "An anonymous note about gas.", at: "2026-11-07T10:00:00+02:00" }),
  post(5, {
    kind: "repost",
    author: "alice",
    labels: ["Staking"],
    text: "Reposted: staking, again.",
    at: "2026-11-09T00:00:00Z",
  }),
  post(6, { author: "dave@other.org", text: "Nothing to see here.", at: "2026-11-10T23:59:59Z" }),
];

const queriedPut: Fields = { source: "fake", kinds: ["post", "repost"], items: queried };

const selectorCases: readonly (readonly [string, Value, readonly string[]])[] = [
  ["an empty selector matches every item", {}, ["fake:1", "fake:2", "fake:3", "fake:4", "fake:5", "fake:6"]],
  ["authors alone, exact", { authors: ["alice"] }, ["fake:1", "fake:5"]],
  ["authors ignore case and a leading @", { authors: ["@ALICE"] }, ["fake:1", "fake:5"]],
  ["authors match a capitalised author", { authors: ["bob"] }, ["fake:2"]],
  ["authors with * match a domain", { authors: ["*@example.com"] }, ["fake:3"]],
  ["authors with two * match every address", { authors: ["*@*"] }, ["fake:3", "fake:6"]],
  ["an author no item has matches nothing", { authors: ["nobody"] }, []],
  [
    "an item with no author never matches authors",
    { authors: ["*"] },
    ["fake:1", "fake:2", "fake:3", "fake:5", "fake:6"],
  ],
  ["labels alone", { labels: ["eth"] }, ["fake:1", "fake:4"]],
  ["labels ignore case", { labels: ["STAKING"] }, ["fake:1", "fake:5"]],
  ["any one of several labels", { labels: ["solana", "eth"] }, ["fake:1", "fake:2", "fake:4"]],
  ["text terms alone", { text: ["staking"] }, ["fake:1", "fake:5"]],
  ["text terms look in the title too, ignoring case", { text: ["BANKS"] }, ["fake:3"]],
  ["any one of several text terms", { text: ["firedancer", "gas"] }, ["fake:2", "fake:4"]],
  ["kinds alone", { kinds: ["repost"] }, ["fake:5"]],
  ["another kind", { kinds: ["post"] }, ["fake:1", "fake:2", "fake:3", "fake:4", "fake:6"]],
  [
    "since includes an item at exactly that time",
    { since: "2026-11-05T10:00:00Z" },
    ["fake:3", "fake:4", "fake:5", "fake:6"],
  ],
  ["until excludes an item at exactly that time", { until: "2026-11-05T10:00:00Z" }, ["fake:1", "fake:2"]],
  [
    "since and until compare times with their zones",
    { since: "2026-11-07T07:00:00Z", until: "2026-11-07T09:00:00Z" },
    ["fake:4"],
  ],
  ["since written with a zone", { since: "2026-11-07T09:00:00+02:00" }, ["fake:4", "fake:5", "fake:6"]],
  ["authors and labels together", { authors: ["alice"], labels: ["eth"] }, ["fake:1"]],
  ["authors and kinds together", { authors: ["alice"], kinds: ["post"] }, ["fake:1"]],
  ["labels, text and since together", { labels: ["eth"], text: ["gas"], since: "2026-11-06T00:00:00Z" }, ["fake:4"]],
  ["fields that each match but never the same item", { authors: ["alice"], text: ["nothing"] }, []],
  ["a window that ends before the author's only item", { authors: ["bob"], until: "2026-11-02T00:00:00Z" }, []],
  [
    "native fields are left to the source",
    { native: { q: "from:alice" } },
    ["fake:1", "fake:2", "fake:3", "fake:4", "fake:5", "fake:6"],
  ],
];

const searchCases: readonly (readonly [string, readonly string[]])[] = [
  ["staking", ["fake:5", "fake:1"]],
  ["banks pilots", ["fake:3"]],
  ["carol", ["fake:3"]],
  ["staking gas", []],
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

function manyPosts(count: number): Fields {
  const items = Array.from({ length: count }, (_, index) =>
    post(index + 1, {
      at: `2026-11-01T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00Z`,
    }),
  );
  return page(items);
}

const cases: readonly Case[] = [
  {
    name: "put then get returns the same items, in the order asked, and names the ids it does not hold",
    run: async (store) => {
      const items = [post(1), post(2, { labels: ["eth", "staking"], author: null })];
      assert.deepEqual(await store.output("put", page(items)), { added: 2, updated: 0, skipped: [] });
      assert.deepEqual(await store.output("get", { ids: ["fake:2", "fake:404", "fake:1"] }), {
        items: [post(2, { labels: ["eth", "staking"], author: null }), post(1)],
        missing: ["fake:404"],
      });
    },
  },
  {
    name: "put replaces an item with the same id instead of adding a second one",
    run: async (store) => {
      await store.output("put", page([post(1)]));
      const changed = post(1, { text: "Edited at the source." });
      assert.deepEqual(await store.output("put", page([changed, post(2)])), { added: 1, updated: 1, skipped: [] });
      assert.deepEqual(await store.output("get", { ids: ["fake:1"] }), { items: [changed], missing: [] });
      assert.equal(field(await store.output("status", {}), "items"), 2);
    },
  },
  {
    name: "a deleted id is remembered and skipped by every later put, with a reason; a local id is not remembered",
    run: async (store) => {
      await store.output("put", page([post(1), post(2)]));
      await store.output("put", notes([note("a")]));
      assert.deepEqual(await store.output("delete", { ids: ["fake:1", "local:a", "fake:9"] }), {
        deleted: ["fake:1", "local:a"],
        missing: ["fake:9"],
        remembered: ["fake:1", "fake:9"],
      });
      const first = await store.output("put", page([post(1), post(9), post(3)]));
      assert.deepEqual([field(first, "added"), field(first, "updated")], [1, 0]);
      assert.deepEqual(reasonsGiven(first), [
        ["fake:1", true],
        ["fake:9", true],
      ]);
      const second = await store.output("put", page([post(1), post(9), post(3)]));
      assert.deepEqual([field(second, "added"), field(second, "updated")], [0, 1]);
      assert.deepEqual(reasonsGiven(second), [
        ["fake:1", true],
        ["fake:9", true],
      ]);
      assert.deepEqual(await store.output("get", { ids: ["fake:1"] }), { items: [], missing: ["fake:1"] });
      assert.deepEqual(await store.output("put", notes([note("a")])), { added: 1, updated: 0, skipped: [] });
    },
  },
  {
    name: "put keeps only the items its selector matches, and gives a reason for each it skips",
    run: async (store) => {
      const selector = { authors: ["alice"], text: ["staking"] };
      const items = [post(1), post(2, { author: "bob" }), post(3, { text: "Nothing relevant." })];
      const output = await store.output("put", page(items, { selector }));
      assert.deepEqual([field(output, "added"), field(output, "updated")], [1, 0]);
      assert.deepEqual(reasonsGiven(output), [
        ["fake:2", true],
        ["fake:3", true],
      ]);
      assert.deepEqual(idsOf(await store.output("query", {})), ["fake:1"]);
    },
  },
  {
    name: "put's selector keeps an item at exactly since and skips one at exactly until, comparing zones",
    run: async (store) => {
      const selector = { since: "2026-11-02T10:00:00Z", until: "2026-11-04T10:00:00Z" };
      const items = [
        post(1, { at: "2026-11-02T12:00:00+02:00" }),
        post(2, { at: "2026-11-04T10:00:00Z" }),
        post(3, { at: "2026-11-02T09:59:59Z" }),
        post(4, { at: "2026-11-04T11:59:59+02:00" }),
      ];
      const output = await store.output("put", page(items, { selector }));
      assert.equal(field(output, "added"), 2);
      assert.deepEqual(reasonsGiven(output), [
        ["fake:2", true],
        ["fake:3", true],
      ]);
    },
  },
  {
    name: "put refuses an item of a kind its source does not produce, and stores nothing of that put",
    run: async (store) => {
      assert.notEqual(await store.failure("put", page([post(1), post(2, { kind: "email" })])), "");
      assert.equal(field(await store.output("status", {}), "items"), 0);
    },
  },
  {
    name: "put refuses an item of another source, or with an id of another source, and stores nothing",
    run: async (store) => {
      assert.notEqual(await store.failure("put", page([post(1), post(2, { source: "x" })])), "");
      assert.notEqual(await store.failure("put", page([post(1), post(2, { id: "x:2" })])), "");
      assert.equal(field(await store.output("status", {}), "items"), 0);
    },
  },
  {
    name: "a local item may not take a kind a source already produces in that store",
    run: async (store) => {
      await store.output("put", page([post(1)]));
      const taken = { source: "local", kinds: ["post"], items: [note("p", "post")] };
      assert.notEqual(await store.failure("put", taken), "");
      assert.deepEqual(await store.output("put", notes([note("n")])), { added: 1, updated: 0, skipped: [] });
      assert.equal(field(await store.output("status", {}), "items"), 2);
    },
  },
  {
    name: "update changes the given fields of a local item, fails for an item it does not hold, and refuses an item from a source",
    run: async (store) => {
      await store.output("put", notes([note("a")]));
      const updated = await store.output("update", { id: "local:a", set: { text: "Changed.", labels: ["later"] } });
      assert.deepEqual(updated, { item: { ...note("a"), text: "Changed.", labels: ["later"] } });
      assert.deepEqual(await store.output("get", { ids: ["local:a"] }), {
        items: [field(updated, "item")],
        missing: [],
      });
      assert.notEqual(await store.failure("update", { id: "local:b", set: { text: "x" } }), "");
      assert.notEqual(await store.refusal("update", { id: "fake:1", set: { text: "x" } }), "");
    },
  },
  {
    name: "prune drops source items created before the time it is given and never the owner's local items",
    run: async (store) => {
      await store.output(
        "put",
        page([post(1, { at: "2026-10-01T00:00:00Z" }), post(2, { at: "2026-11-10T00:00:00Z" })]),
      );
      await store.output("put", notes([{ ...note("old"), at: "2025-01-01T00:00:00Z" }]));
      assert.deepEqual(await store.output("prune", { before: "2026-11-01T00:00:00Z" }), { removed: 1, remaining: 2 });
      const got = await store.output("get", { ids: ["fake:1", "fake:2", "local:old"] });
      assert.deepEqual([idsOf(got), field(got, "missing")], [["fake:2", "local:old"], ["fake:1"]]);
    },
  },
  {
    name: "prune compares times with their zones, not as text",
    run: async (store) => {
      const early = post(1, { at: "2026-11-01T01:00:00+02:00" });
      const late = post(2, { at: "2026-10-31T23:30:00-02:00" });
      await store.output("put", page([early, late]));
      assert.deepEqual(await store.output("prune", { before: "2026-11-01T00:00:00Z" }), { removed: 1, remaining: 1 });
      assert.deepEqual(await store.output("get", { ids: ["fake:1", "fake:2"] }), {
        items: [late],
        missing: ["fake:1"],
      });
    },
  },
  {
    name: "status gives the counts and, per source, its kinds, items, cursor, last sync, selector and spend, which a later put without them keeps",
    run: async (store) => {
      const selector = { authors: ["alice"] };
      await store.output("put", page([post(1), post(2)], { cursor: "c-2", cost: { items: 2, usd: 0.25 }, selector }));
      await store.output("delete", { ids: ["fake:2"] });
      const source = {
        source: "fake",
        kinds: ["post"],
        items: 1,
        cursor: "c-2",
        lastSync: startAt,
        selector,
        spent: [{ month, items: 2, usd: 0.25 }],
      };
      assert.deepEqual(await store.output("status", {}), { items: 1, deletions: 1, sources: [source] });
      await store.output("put", page([post(3)]));
      assert.deepEqual(await store.output("status", {}), {
        items: 2,
        deletions: 1,
        sources: [{ ...source, items: 2 }],
      });
    },
  },
  {
    name: "the cost of a page is counted once, however often the same page is put, and each new page adds its own",
    run: async (store) => {
      const request = page([post(1), post(2)], { cursor: "c-2", cost: { items: 2, usd: 0.5 } });
      await store.output("put", request);
      await store.output("put", request);
      await store.output("put", page([post(3)], { cursor: "c-3", cost: { items: 1, usd: 0.25 } }));
      const [source] = listOf(field(await store.output("status", {}), "sources"));
      assert.deepEqual(field(source ?? null, "spent"), [{ month, items: 3, usd: 0.75 }]);
    },
  },
  {
    name: "allowance gives a source's monthly cap, what this caller spent on it this month and what is left",
    run: async (store) => {
      const noSpend = { source: "fake", month, capUsd: 1, spentUsd: 0, remainingUsd: 1 };
      assert.deepEqual(await store.output("allowance", { source: "fake" }), noSpend);
      await store.output("put", page([post(1)], { cursor: "c-1", cost: { items: 1, usd: 0.25 } }));
      assert.deepEqual(await store.output("allowance", { source: "fake" }), {
        ...noSpend,
        spentUsd: 0.25,
        remainingUsd: 0.75,
      });
      await store.output("put", page([post(2)], { cursor: "c-2", cost: { items: 4, usd: 1 } }));
      assert.deepEqual(await store.output("allowance", { source: "fake" }), {
        ...noSpend,
        spentUsd: 1.25,
        remainingUsd: -0.25,
      });
      const uncapped = { source: "other", month, capUsd: null, spentUsd: 0, remainingUsd: null };
      assert.deepEqual(await store.output("allowance", { source: "other" }), uncapped);
      assert.deepEqual(await store.as("allowance-elsewhere").output("allowance", { source: "fake" }), noSpend);
    },
  },
  {
    name: "query's selector matches field by field and combined, as the selector schema says",
    run: async (store) => {
      await store.output("put", queriedPut);
      for (const [name, selector, expected] of selectorCases) {
        const ids = idsOf(await store.output("query", { selector, order: "oldest" }));
        assert.deepEqual(ids, expected, name);
      }
    },
  },
  {
    name: "query returns the newest first by default, the oldest first on request, at most the limit, and says when more matched",
    run: async (store) => {
      await store.output("put", queriedPut);
      const newest = ["fake:6", "fake:5", "fake:4", "fake:3", "fake:2", "fake:1"];
      assert.deepEqual(await store.output("query", {}), { items: [...queried].reverse(), more: false });
      assert.deepEqual(idsOf(await store.output("query", { order: "oldest" })), [...newest].reverse());
      const limited = await store.output("query", { selector: { limit: 2 } });
      assert.deepEqual([idsOf(limited), field(limited, "more")], [["fake:6", "fake:5"], true]);
      assert.equal(field(await store.output("query", { selector: { limit: 6 } }), "more"), false);
    },
  },
  {
    name: "query returns at most 100 items when the selector gives no limit",
    run: async (store) => {
      await store.output("put", manyPosts(101));
      const output = await store.output("query", {});
      const ids = idsOf(output);
      assert.deepEqual([ids.length, ids[0], ids[99], field(output, "more")], [100, "fake:101", "fake:2", true]);
    },
  },
  {
    name: "a search finds items with every word in the title, text or author, and punctuation and quotes are plain text",
    run: async (store) => {
      await store.output("put", queriedPut);
      for (const [search, expected] of searchCases) {
        assert.deepEqual(idsOf(await store.output("query", { search })), expected, search);
      }
      assert.deepEqual(idsOf(await store.output("query", { search: "staking", selector: { kinds: ["post"] } })), [
        "fake:1",
      ]);
    },
  },
  {
    name: "a search with no letters or digits is refused",
    run: async (store) => {
      for (const search of ['"', "***", "(", " - "]) {
        assert.notEqual(await store.failure("query", { search }), "", search);
      }
    },
  },
  {
    name: "sql runs one select over items_view, one row per item with plain columns, and returns columns and rows",
    run: async (store) => {
      await store.output("put", page([post(1, { labels: ["eth"] }), post(2)]));
      assert.deepEqual(await store.output("sql", { sql: "select * from items_view where id = 'fake:1'" }), {
        columns: ["id", "kind", "source", "at", "title", "text", "url", "author", "labels", "data"],
        rows: [
          [
            "fake:1",
            "post",
            "fake",
            "2026-11-02T10:00:00Z",
            null,
            "Post number 1 about staking.",
            "https://fake.example/posts/1",
            "alice",
            '["eth"]',
            '{"likes":1}',
          ],
        ],
      });
      assert.deepEqual(
        await store.output("sql", { sql: "select author, count(*) as posts from items_view group by author" }),
        {
          columns: ["author", "posts"],
          rows: [["alice", 2]],
        },
      );
    },
  },
  {
    name: "sql refuses a second statement, a write and attach, and the items stay",
    run: async (store) => {
      await store.output("put", page([post(1), post(2)]));
      for (const sql of ["select 1; select 2", "delete from items_view", "attach database 'other.db' as other"]) {
        assert.notEqual(await store.failure("sql", { sql }), "", sql);
      }
      assert.deepEqual(await store.output("sql", { sql: "select count(*) as n from items_view" }), {
        columns: ["n"],
        rows: [[2]],
      });
    },
  },
  {
    name: "one caller never sees another caller's items, through get, query, status or sql",
    run: async (store) => {
      await store.output("put", page([post(1), post(2)]));
      const other = store.as("callers-elsewhere");
      await other.output("put", notes([note("theirs")]));
      assert.deepEqual(await store.output("get", { ids: ["local:theirs"] }), { items: [], missing: ["local:theirs"] });
      assert.deepEqual(idsOf(await store.output("query", {})), ["fake:2", "fake:1"]);
      assert.equal(field(await store.output("status", {}), "items"), 2);
      const counted = await store.output("sql", { sql: "select count(*) as n from items_view" });
      assert.deepEqual(field(counted, "rows"), [[2]]);
      assert.deepEqual(idsOf(await other.output("query", {})), ["local:theirs"]);
    },
  },
];

const otherCallers = ["allowance-elsewhere", "callers-elsewhere"];

function callerOf(index: number): string {
  return `case-${String(index + 1)}`;
}

function storeFor(project: ModeProject, mode: string, caller: string): Store {
  const reference = (action: string): string => `${interfaceName}.${action}`;
  return {
    output: (action, input) => project.output(reference(action), input, { caller }),
    failure: (action, input) => project.failure(reference(action), input, { caller }),
    refusal: (action, input) => project.refusal(`${mode}.${action}`, input),
    as: (other) => storeFor(project, mode, other),
  };
}

export function testItemsStore(underTest: ItemsStoreUnderTest): void {
  const { mode } = underTest;
  let project: ModeProject;
  before(async () => {
    const config = {
      bindings: { [interfaceName]: mode },
      adapter: "claude-code",
      modes: [mode],
      settings: { [mode]: { monthlyUsd: { fake: 1 } } },
    };
    const callers = [...cases.map((_, index) => callerOf(index)), ...otherCallers];
    project = await openModeProject(config, { startAt, callers });
  });
  after(async () => {
    await project.close();
  });
  for (const [index, entry] of cases.entries()) {
    test(`${interfaceName}@1, ${mode}: ${entry.name}`, async () => {
      await entry.run(storeFor(project, mode, callerOf(index)));
    });
  }
}
