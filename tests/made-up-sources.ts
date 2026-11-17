import { stringify } from "yaml";

import type { ModeFiles } from "./kit-copy.ts";

export type AlmanacVariant = "continues after the cursor" | "repeats the item at the cursor";

export const almanac = "almanac";

export const wrongAlmanac = "almanac-wrong";

const sdkFromScripts = "../../../../bay/sdk.ts";

const sdkFromLibrary = "../../../../../bay/sdk.ts";

const sharedTestFromTests = "../../../base/interfaces/items-source/tests/shared.ts";

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function lines(...texts: readonly string[]): string {
  return `${texts.join("\n")}\n`;
}

function manifestOf(name: string): string {
  return stringify({
    name,
    version: "1.0.0",
    description: "Serves nine made-up events and reminders; an items-source@1 that a test adds to a copy of the kit.",
    implements: ["items-source@1"],
    settings: "schemas/settings.json",
    actions: {
      fetch: {
        description: "When a test needs the next page of made-up events and reminders after a cursor.",
        effects: ["read", "network", "spend"],
        run: [{ script: "scripts/fetch.ts" }],
      },
      describe: {
        description: "When a test needs the source's name, kinds, native fields and what one page costs.",
        effects: ["read"],
        run: [{ script: "scripts/describe.ts" }],
      },
    },
  });
}

const settingsSchema = json({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "AlmanacSettings",
  description: "Settings of a made-up source of events and reminders.",
  type: "object",
  additionalProperties: false,
  properties: {
    pageSize: { type: "integer", minimum: 1, maximum: 500, description: "The most entries one fetch returns." },
    pageUsd: {
      type: "number",
      minimum: 0,
      description: "What one fetch costs in US dollars, however many it returns.",
    },
  },
});

const continuesLine = "    .filter((candidate) => candidate.position > after && matches(selector, candidate.entry));";

const repeatsLine = "    .filter((candidate) => candidate.position >= after && matches(selector, candidate.entry));";

const library = String.raw`import { fieldsOf, parseIsoTime, type Json, type JsonFields } from "${sdkFromLibrary}";

export const sourceName = "almanac";

export const sourceKinds: readonly string[] = ["event", "reminder"];

export const nativeFields: readonly string[] = ["kinds", "since", "labels", "limit"];

type Entry = {
  readonly id: string;
  readonly kind: string;
  readonly at: string;
  readonly title: string | null;
  readonly text: string;
  readonly author: string | null;
  readonly labels: readonly string[];
};

type Settings = { readonly pageSize: number; readonly pageUsd: number };

type Page = { readonly items: readonly Json[]; readonly cursor: string | null; readonly more: boolean };

const entries: readonly Entry[] = [
  { id: "almanac:e1", kind: "event", at: "2026-11-02T09:00:00Z", title: "Staking committee", text: "The committee meets to choose operators.", author: "ops", labels: ["work"] },
  { id: "almanac:r1", kind: "reminder", at: "2026-11-03T08:00:00Z", title: null, text: "Renew the custody contract.", author: null, labels: ["work", "legal"] },
  { id: "almanac:e2", kind: "event", at: "2026-11-04T15:00:00Z", title: "Dentist", text: "A check-up at the clinic.", author: "self", labels: ["home"] },
  { id: "almanac:r2", kind: "reminder", at: "2026-11-05T07:30:00Z", title: null, text: "Water the plants.", author: null, labels: ["home"] },
  { id: "almanac:e3", kind: "event", at: "2026-11-06T22:00:00Z", title: "Validator upgrade window", text: "Two hours of planned downtime.", author: "ops", labels: ["work", "ops"] },
  { id: "almanac:r3", kind: "reminder", at: "2026-11-07T10:00:00Z", title: null, text: "Pay the electricity bill.", author: null, labels: ["home", "bills"] },
  { id: "almanac:e4", kind: "event", at: "2026-11-08T13:00:00Z", title: "Quarterly review", text: "Numbers for the quarter.", author: "lead", labels: ["work"] },
  { id: "almanac:r4", kind: "reminder", at: "2026-11-09T18:00:00Z", title: null, text: "Book flights for the conference.", author: "self", labels: ["travel"] },
  { id: "almanac:e5", kind: "event", at: "2026-11-10T19:30:00Z", title: "Dinner with friends", text: "At the corner place.", author: "self", labels: [] },
];

const cursorPrefix = "almanac/";

function texts(value: Json | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function settingsOf(settings: Readonly<Record<string, Json>>): Settings {
  const pageSize = typeof settings.pageSize === "number" ? settings.pageSize : 4;
  const pageUsd = typeof settings.pageUsd === "number" ? settings.pageUsd : 0.05;
  return { pageSize, pageUsd };
}

function matches(selector: JsonFields, entry: Entry): boolean {
  const kinds = texts(selector.kinds);
  const labels = texts(selector.labels).map((label) => label.toLowerCase());
  const since = typeof selector.since === "string" ? parseIsoTime(selector.since)?.getTime() : undefined;
  const kindMatches = kinds.length === 0 || kinds.includes(entry.kind);
  const labelMatches = labels.length === 0 || entry.labels.some((label) => labels.includes(label.toLowerCase()));
  const sinceMatches = since === undefined || Date.parse(entry.at) >= since;
  return kindMatches && labelMatches && sinceMatches;
}

function positionAfter(cursor: Json | undefined): number {
  const made = typeof cursor === "string" && /^almanac\/\d+$/.test(cursor);
  return made ? Number(cursor.slice(cursorPrefix.length)) : -1;
}

function itemOf(entry: Entry): Json {
  return { ...entry, source: sourceName, url: null, data: {} };
}

export function pageOf(input: Json, settings: Settings): Page {
  const request = fieldsOf(input);
  const selector = fieldsOf(request.selector ?? {});
  const after = positionAfter(request.cursor);
  const limit = typeof selector.limit === "number" ? selector.limit : settings.pageSize;
  const waiting = entries
    .map((entry, position) => ({ entry, position }))
    .filter((candidate) => candidate.position > after && matches(selector, candidate.entry));
  const taken = waiting.slice(0, Math.min(settings.pageSize, limit));
  const last = taken.at(-1)?.position ?? after;
  return {
    items: taken.map((waiting) => itemOf(waiting.entry)),
    cursor: last < 0 ? null : cursorPrefix + String(last),
    more: waiting.length > taken.length,
  };
}
`;

const fetchScript = lines(
  `import { defineScript, fail } from "${sdkFromScripts}";`,
  'import { pageOf, settingsOf, sourceKinds, sourceName } from "./lib/almanac.ts";',
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const settings = settingsOf(context.settings);",
  "  const page = pageOf(input, settings);",
  "  const cost = { items: page.items.length, usd: settings.pageUsd };",
  "  const charged = await context.spend(cost);",
  "  if (!charged.ok) {",
  "    return fail(charged.message);",
  "  }",
  "  return { source: sourceName, kinds: sourceKinds, ...page, cost };",
  "});",
);

const describeScript = lines(
  `import { defineScript } from "${sdkFromScripts}";`,
  'import { nativeFields, settingsOf, sourceKinds, sourceName } from "./lib/almanac.ts";',
  "",
  "export const run = defineScript((_input, context) => {",
  "  const pageCostUsd = settingsOf(context.settings).pageUsd;",
  "  return Promise.resolve({ source: sourceName, kinds: sourceKinds, nativeFields, pageCostUsd });",
  "});",
);

const firstEntry = {
  id: "almanac:e1",
  kind: "event",
  source: "almanac",
  at: "2026-11-02T09:00:00Z",
  title: "Staking committee",
  text: "The committee meets to choose operators.",
  url: null,
  author: "ops",
  labels: ["work"],
  data: {},
};

const examples = {
  describe: {
    input: {},
    output: {
      source: "almanac",
      kinds: ["event", "reminder"],
      nativeFields: ["kinds", "since", "labels", "limit"],
      pageCostUsd: 0.05,
    },
  },
  fetch: {
    input: { selector: { limit: 1 }, cursor: null },
    output: {
      source: "almanac",
      kinds: ["event", "reminder"],
      items: [firstEntry],
      cursor: "almanac/0",
      more: true,
      cost: { items: 1, usd: 0.05 },
    },
  },
};

function modeTest(name: string): string {
  return lines(
    `import { testItemsSource } from "${sharedTestFromTests}";`,
    "",
    "testItemsSource({",
    `  mode: "${name}",`,
    "  start: () =>",
    "    Promise.resolve({",
    "      settings: { pageSize: 4, pageUsd: 0.05 },",
    '      startAt: "2026-11-15T12:00:00.000Z",',
    "      stop: () => Promise.resolve(),",
    "    }),",
    "  walk: { pages: [4, 4, 1], cost: { items: 9, usd: 0.15 } },",
    "});",
  );
}

export function almanacFiles(name: string, variant: AlmanacVariant): ModeFiles {
  const chosen = variant === "continues after the cursor" ? library : library.replace(continuesLine, repeatsLine);
  return {
    "mode.yaml": manifestOf(name),
    "README.md": lines(
      `# ${name}`,
      "",
      "Serves nine made-up events and reminders. A test adds it to a copy of the kit.",
    ),
    "schemas/settings.json": settingsSchema,
    "scripts/lib/almanac.ts": chosen,
    "scripts/fetch.ts": fetchScript,
    "scripts/describe.ts": describeScript,
    "tests/describe.example.json": json(examples.describe),
    "tests/fetch.example.json": json(examples.fetch),
    [`tests/${name}.test.ts`]: modeTest(name),
  };
}
