import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  openModeProject,
  type ModeProject,
  type ProjectFolder,
  type ProjectOptions,
  type Run,
} from "../../../../../tests/test-toolbox.ts";

type Value = Awaited<ReturnType<ModeProject["output"]>>;

type Fields = { readonly [key: string]: Value };

export type Cost = {
  readonly items: number;
  readonly usd: number;
};

export type Started = {
  readonly settings: Readonly<Record<string, Value>>;
  readonly startAt: string;
  readonly stop: () => Promise<void>;
};

export type Walk = {
  readonly pages: readonly number[];
  readonly cost: Cost;
};

export type ItemsSourceUnderTest = {
  readonly mode: string;
  readonly start: () => Promise<Started>;
  readonly walk: Walk;
};

type Description = {
  readonly source: string;
  readonly kinds: readonly string[];
  readonly nativeFields: readonly string[];
  readonly pageCostUsd: number | undefined;
};

type Item = {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly at: string;
  readonly title: string | null;
  readonly text: string;
  readonly author: string | null;
  readonly labels: readonly string[];
};

type Page = {
  readonly source: string;
  readonly kinds: readonly string[];
  readonly items: readonly Item[];
  readonly cursor: Value;
  readonly more: boolean;
  readonly cost: Cost;
};

type Probe = {
  readonly field: string;
  readonly selector: Fields;
  readonly matches: (item: Item) => boolean;
};

type Opening = {
  readonly config: Parameters<typeof openModeProject>[0];
  readonly options: ProjectOptions;
};

type Source = Opening & {
  readonly underTest: ItemsSourceUnderTest;
  readonly on: (project: ModeProject) => Source;
  readonly describe: () => Promise<Description>;
  readonly fetchRun: (selector: Fields, cursor: Value) => Promise<Run>;
  readonly fetch: (selector: Fields, cursor: Value) => Promise<Page>;
  readonly walkRuns: (selector: Fields) => Promise<readonly Run[]>;
  readonly walk: (selector: Fields) => Promise<readonly Page[]>;
};

type Case = {
  readonly name: string;
  readonly restsOn: string;
  readonly run: (source: Source) => Promise<void>;
};

const interfaceName = "items-source";

const foreignCursor = "a-cursor-no-source-made";

function isFields(value: Value | undefined): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: Value | undefined): value is readonly Value[] {
  return Array.isArray(value);
}

function fieldsOf(value: Value | undefined): Fields {
  assert.ok(isFields(value), JSON.stringify(value));
  return value;
}

function listOf(value: Value | undefined): readonly Value[] {
  assert.ok(isList(value), JSON.stringify(value));
  return value;
}

function textOf(value: Value | undefined): string {
  assert.ok(typeof value === "string", JSON.stringify(value));
  return value;
}

function textOrNullOf(value: Value | undefined): string | null {
  return value === null ? null : textOf(value);
}

function textsOf(value: Value | undefined): readonly string[] {
  return listOf(value).map(textOf);
}

function numberOf(value: Value | undefined): number {
  assert.ok(typeof value === "number", JSON.stringify(value));
  return value;
}

function dollars(usd: number): number {
  return Math.round(usd * 1e9) / 1e9;
}

function costOf(value: Value | undefined): Cost {
  const fields = fieldsOf(value);
  return { items: numberOf(fields.items), usd: numberOf(fields.usd) };
}

function descriptionOf(value: Value): Description {
  const fields = fieldsOf(value);
  return {
    source: textOf(fields.source),
    kinds: textsOf(fields.kinds),
    nativeFields: textsOf(fields.nativeFields),
    pageCostUsd: fields.pageCostUsd === undefined ? undefined : numberOf(fields.pageCostUsd),
  };
}

function itemOf(value: Value): Item {
  const fields = fieldsOf(value);
  return {
    id: textOf(fields.id),
    kind: textOf(fields.kind),
    source: textOf(fields.source),
    at: textOf(fields.at),
    title: textOrNullOf(fields.title),
    text: textOf(fields.text),
    author: textOrNullOf(fields.author),
    labels: textsOf(fields.labels),
  };
}

function pageOf(value: Value): Page {
  const fields = fieldsOf(value);
  assert.ok(typeof fields.more === "boolean", JSON.stringify(fields.more));
  return {
    source: textOf(fields.source),
    kinds: textsOf(fields.kinds),
    items: listOf(fields.items).map(itemOf),
    cursor: fields.cursor ?? null,
    more: fields.more,
    cost: costOf(fields.cost),
  };
}

function outputOf(run: Run): Value {
  if (run.state.status !== "done") {
    assert.fail(`expected the fetch to be done, got ${JSON.stringify(run.state)}`);
  }
  return run.state.output;
}

function chargedOf(run: Run): Cost {
  return { items: run.spent.items, usd: dollars(run.spent.usd) };
}

function itemsOf(pages: readonly Page[]): readonly Item[] {
  return pages.flatMap((page) => page.items);
}

function idsOf(items: readonly Item[]): readonly string[] {
  return items.map((item) => item.id);
}

function totalOf(walk: Walk): number {
  return walk.pages.reduce((sum, count) => sum + count, 0);
}

function timeOf(item: Item): number {
  return Date.parse(item.at);
}

function nameOf(name: string): string {
  return name.trim().toLowerCase().replace(/^@/, "");
}

function patternOf(pattern: string): RegExp {
  const parts = nameOf(pattern)
    .split("*")
    .map((part) => part.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&"));
  return new RegExp(`^${parts.join(".*")}$`, "s");
}

function authorProbes(items: readonly Item[]): readonly Probe[] {
  const named = items.flatMap((item) => (item.author === null || item.author.includes("*") ? [] : [item.author]));
  const author = named.find((name) =>
    items.some((item) => item.author === null || nameOf(item.author) !== nameOf(name)),
  );
  if (author === undefined) {
    return [];
  }
  const plain = nameOf(author);
  const pattern = `${plain.slice(0, 2).toUpperCase()}*`;
  return [
    {
      field: "authors",
      selector: { authors: [`@${plain.toUpperCase()}`] },
      matches: (item) => item.author !== null && nameOf(item.author) === plain,
    },
    {
      field: "authors with a pattern",
      selector: { authors: [pattern] },
      matches: (item) => item.author !== null && patternOf(pattern).test(nameOf(item.author)),
    },
  ];
}

function labelProbes(items: readonly Item[]): readonly Probe[] {
  const carries = (item: Item, label: string): boolean =>
    item.labels.some((carried) => carried.toLowerCase() === label.toLowerCase());
  const label = items
    .flatMap((item) => item.labels)
    .find((candidate) => items.some((item) => !carries(item, candidate)));
  return label === undefined
    ? []
    : [{ field: "labels", selector: { labels: [label.toUpperCase()] }, matches: (item) => carries(item, label) }];
}

function textProbes(items: readonly Item[]): readonly Probe[] {
  const first = items.find((item) => item.text.trim() !== "");
  if (first === undefined) {
    return [];
  }
  const term = first.text.trim().slice(0, 24);
  const holds = (value: string | null): boolean => value !== null && value.toLowerCase().includes(term.toLowerCase());
  return [
    {
      field: "text",
      selector: { text: [term.toUpperCase()] },
      matches: (item) => holds(item.title) || holds(item.text),
    },
  ];
}

function timeProbes(items: readonly Item[]): readonly Probe[] {
  const middle = items[Math.floor(items.length / 2)];
  if (middle === undefined) {
    return [];
  }
  const at = timeOf(middle);
  return [
    { field: "since", selector: { since: middle.at }, matches: (item) => timeOf(item) >= at },
    { field: "until", selector: { until: middle.at }, matches: (item) => timeOf(item) < at },
  ];
}

function kindProbes(items: readonly Item[]): readonly Probe[] {
  const kind = items[0]?.kind;
  return kind === undefined
    ? []
    : [{ field: "kinds", selector: { kinds: [kind] }, matches: (item) => item.kind === kind }];
}

function probesOf(items: readonly Item[]): readonly Probe[] {
  return [
    ...authorProbes(items),
    ...labelProbes(items),
    ...textProbes(items),
    ...timeProbes(items),
    ...kindProbes(items),
  ];
}

async function everyItem(source: Source): Promise<readonly Item[]> {
  const items = itemsOf(await source.walk({}));
  assert.notDeepEqual(items, [], "the walk given must hold items");
  return items;
}

const cases: readonly Case[] = [
  {
    name: "describe and every page of fetch name the same source and the same kinds",
    restsOn: "describe-response source and kinds; fetch-response source and kinds (every kind this source produces)",
    run: async (source) => {
      const { source: name, kinds } = await source.describe();
      const pages = await source.walk({});
      assert.deepEqual(
        pages.map((page) => ({ source: page.source, kinds: page.kinds })),
        pages.map(() => ({ source: name, kinds })),
      );
    },
  },
  {
    name: "every item's id is the source's name, a colon and more; its source is that name; its kind is one describe lists",
    restsOn:
      "fetch-response item id (<source>:<external id>), item source (the same as the prefix of its id), item kind",
    run: async (source) => {
      const { source: name, kinds } = await source.describe();
      const items = await everyItem(source);
      assert.deepEqual(
        items
          .filter((item) => !item.id.startsWith(`${name}:`) || item.id.length === name.length + 1)
          .map((item) => item.id),
        [],
      );
      assert.deepEqual(
        items.filter((item) => item.source !== name).map((item) => item.id),
        [],
      );
      assert.deepEqual(
        items.filter((item) => !kinds.includes(item.kind)).map((item) => [item.id, item.kind]),
        [],
      );
    },
  },
  {
    name: "fetching every page with the cursor gives every item once, oldest first, in the pages given, and more is false only on the last",
    restsOn:
      "fetch-request cursor (where the last fetch ended); fetch-response items (oldest first), cursor (continue after these items) and more",
    run: async (source) => {
      const { pages: counts } = source.underTest.walk;
      const pages = await source.walk({});
      assert.deepEqual(
        pages.map((page) => page.items.length),
        counts,
      );
      assert.deepEqual(
        pages.map((page) => page.more),
        counts.map((_, index) => index < counts.length - 1),
      );
      const ids = idsOf(itemsOf(pages));
      assert.deepEqual(
        ids.filter((id, index) => ids.indexOf(id) !== index),
        [],
      );
      const items = itemsOf(pages);
      assert.deepEqual(
        items.flatMap((item, index) => {
          const before = items[index - 1];
          return before !== undefined && timeOf(item) < timeOf(before) ? [[before.id, item.id]] : [];
        }),
        [],
      );
    },
  },
  {
    name: "the cursor of the last page gives no items and more false",
    restsOn:
      "fetch-response cursor (pass it back to continue after these items) and more (whether another page is ready)",
    run: async (source) => {
      const last = (await source.walk({})).at(-1);
      assert.ok(last !== undefined);
      const after = await source.fetch({}, last.cursor);
      assert.deepEqual({ items: idsOf(after.items), more: after.more }, { items: [], more: false });
    },
  },
  {
    name: "after the project is opened again, a page's cursor continues with the next page, and the last one with nothing",
    restsOn: "fetch-response cursor (pass it back to continue after these items, now or on a later sync)",
    run: async (source) => {
      const project = await openModeProject(source.config, source.options);
      let current = project;
      try {
        const pages = await source.on(project).walk({});
        assert.ok(pages.length > 1, "the walk given must have at least two pages");
        current = await project.reopen(source.config);
        const later = source.on(current);
        const continued: (readonly string[])[] = [];
        for (const page of pages) {
          continued.push(idsOf((await later.fetch({}, page.cursor)).items));
        }
        assert.deepEqual(continued, [...pages.slice(1).map((page) => idsOf(page.items)), []]);
      } finally {
        await current.close();
      }
    },
  },
  {
    name: "the ids are the same on every walk",
    restsOn: "fetch-response item id (the same on every sync)",
    run: async (source) => {
      const first = idsOf(await everyItem(source));
      assert.deepEqual(idsOf(await everyItem(source)), first);
    },
  },
  {
    name: "a cursor the source did not make is refused with a reason and charges nothing, or starts again from the beginning",
    restsOn:
      "fetch-request cursor (exactly as its response gave it; null starts from the beginning); the interface does not say which of the two",
    run: async (source) => {
      const run = await source.fetchRun({}, foreignCursor);
      if (run.state.status === "failed") {
        assert.notEqual(run.state.reason.trim(), "");
        assert.deepEqual(chargedOf(run), { items: 0, usd: 0 });
        return;
      }
      const fromTheBeginning = await source.fetch({}, null);
      assert.deepEqual(idsOf(pageOf(outputOf(run)).items), idsOf(fromTheBeginning.items));
    },
  },
  {
    name: "no page costs less than nothing or more than describe's pageCostUsd, and the walk costs what the mode's test says",
    restsOn:
      "fetch-response cost (items and usd, each at least 0); describe-response pageCostUsd (the most one fetch can cost)",
    run: async (source) => {
      const { pageCostUsd } = await source.describe();
      const pages = await source.walk({});
      const last = pages.at(-1);
      assert.ok(last !== undefined);
      const costs = [...pages, await source.fetch({}, last.cursor)].map((page) => page.cost);
      const most = pageCostUsd ?? Number.POSITIVE_INFINITY;
      assert.deepEqual(
        costs.filter((cost) => cost.items < 0 || cost.usd < 0 || cost.usd > most),
        [],
      );
      const total = pages.reduce(
        (sum, page) => ({ items: sum.items + page.cost.items, usd: dollars(sum.usd + page.cost.usd) }),
        { items: 0, usd: 0 },
      );
      assert.deepEqual(total, source.underTest.walk.cost);
    },
  },
  {
    name: "each fetch charges its run exactly the cost it reports",
    restsOn: "items-source.yaml fetch effects (spend); fetch-response cost (what this page cost to fetch)",
    run: async (source) => {
      const runs = await source.walkRuns({});
      assert.deepEqual(
        runs.map(chargedOf),
        runs.map((run) => pageOf(outputOf(run)).cost),
      );
    },
  },
  {
    name: "a budget smaller than a page makes fetch wait for budget, and extending it gives that page",
    restsOn:
      "items-source.yaml fetch effects (spend); describe-response pageCostUsd (so a sync can stop before a page would pass a cap)",
    run: async (source) => {
      const first = await source.fetch({}, null);
      assert.ok(first.cost.usd > 0, "the settings given must make the first page cost something");
      const budget = dollars(first.cost.usd / 2);
      const project = await openModeProject({ ...source.config, budget: { usd: budget } }, source.options);
      try {
        const run = await project.run(`${source.underTest.mode}.fetch`, { selector: {}, cursor: null });
        assert.deepEqual(run.state.status === "waiting" ? run.state.waiting.reason : run.state.status, "budget");
        const extended = await project.extend(run.id, { usd: first.cost.usd });
        assert.deepEqual(idsOf(pageOf(outputOf(extended)).items), idsOf(first.items));
        assert.deepEqual(chargedOf(extended), first.cost);
      } finally {
        await project.close();
      }
    },
  },
  {
    name: "a selector field, applied by the source or left to the store, never drops an item it matches",
    restsOn:
      "fetch-request selector (may return more than the others ask for, never less); the selector's fields as its schema describes them",
    run: async (source) => {
      const items = await everyItem(source);
      const probes = probesOf(items);
      const missing: { readonly field: string; readonly missing: readonly string[] }[] = [];
      for (const probe of probes) {
        const returned = new Set(idsOf(itemsOf(await source.walk(probe.selector))));
        const expected = idsOf(items.filter(probe.matches));
        missing.push({ field: probe.field, missing: expected.filter((id) => !returned.has(id)) });
      }
      assert.deepEqual(
        missing,
        probes.map((probe) => ({ field: probe.field, missing: [] })),
      );
    },
  },
  {
    name: "a selector field the source applies itself leaves out items that do not match it",
    restsOn:
      "describe-response nativeFields (the selector fields the source applies when it fetches); fetch-request selector",
    run: async (source) => {
      const { nativeFields } = await source.describe();
      const items = await everyItem(source);
      const probes = probesOf(items).filter((probe) => nativeFields.includes(probe.field));
      const narrowed: { readonly field: string; readonly leavesOut: boolean }[] = [];
      for (const probe of probes) {
        const returned = itemsOf(await source.walk(probe.selector));
        narrowed.push({ field: probe.field, leavesOut: returned.length < items.length });
      }
      assert.deepEqual(
        narrowed,
        probes.map((probe) => ({ field: probe.field, leavesOut: items.some((item) => !probe.matches(item)) })),
      );
    },
  },
  {
    name: "a limit the source applies itself returns that many items on the first page",
    restsOn: "fetch-request selector limit (the most items one sync fetches); describe-response nativeFields",
    run: async (source) => {
      const { nativeFields } = await source.describe();
      const first = source.underTest.walk.pages[0] ?? 0;
      assert.ok(first > 1, "the walk given must start with a page of more than one item");
      const page = await source.fetch({ limit: 1 }, null);
      assert.equal(page.items.length, nativeFields.includes("limit") ? 1 : first);
    },
  },
];

function sourceFor(project: ModeProject, underTest: ItemsSourceUnderTest, opening: Opening): Source {
  const reference = (action: string): string => `${underTest.mode}.${action}`;
  const fetchRun = (selector: Fields, cursor: Value): Promise<Run> =>
    project.run(reference("fetch"), { selector, cursor });
  const most = totalOf(underTest.walk) + 2;
  const walkRuns = async (selector: Fields): Promise<readonly Run[]> => {
    const runs: Run[] = [];
    let cursor: Value = null;
    let more = true;
    while (more) {
      assert.ok(runs.length < most, `the walk did not end within ${String(most)} pages`);
      const run = await fetchRun(selector, cursor);
      const page = pageOf(outputOf(run));
      runs.push(run);
      cursor = page.cursor;
      more = page.more;
    }
    return runs;
  };
  return {
    ...opening,
    underTest,
    on: (other) => sourceFor(other, underTest, opening),
    describe: async () => descriptionOf(await project.output(reference("describe"), {})),
    fetchRun,
    fetch: async (selector, cursor) => pageOf(outputOf(await fetchRun(selector, cursor))),
    walkRuns,
    walk: async (selector) => (await walkRuns(selector)).map((run) => pageOf(outputOf(run))),
  };
}

function configOf(underTest: ItemsSourceUnderTest, started: Started): Parameters<typeof openModeProject>[0] {
  const { mode } = underTest;
  return { bindings: {}, adapter: "claude-code", modes: [mode], settings: { [mode]: started.settings } };
}

export function testItemsSource(underTest: ItemsSourceUnderTest, projectFolder: ProjectFolder = {}): void {
  const { mode } = underTest;
  let started: Started;
  let opening: Opening;
  let project: ModeProject;
  before(async () => {
    started = await underTest.start();
    opening = { config: configOf(underTest, started), options: { ...projectFolder, startAt: started.startAt } };
    project = await openModeProject(opening.config, opening.options);
  });
  after(async () => {
    await project.close();
    await started.stop();
  });
  for (const entry of cases) {
    test(`${interfaceName}@1, ${mode}: ${entry.name}`, async () => {
      await entry.run(sourceFor(project, underTest, opening));
    });
  }
}
