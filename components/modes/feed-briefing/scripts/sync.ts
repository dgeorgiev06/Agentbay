import { canonicalJson, defineScript, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { called } from "./lib/calls.ts";
import { fieldsOf, listOf, numberOf, textOf, type Fields } from "./lib/json.ts";
import { settingsOf, timeOf, type Settings } from "./lib/settings.ts";

type Totals = {
  pages: number;
  fetched: number;
  added: number;
  updated: number;
  skipped: number;
  items: number;
  usd: number;
};

type Start = {
  readonly source: string;
  readonly cursor: Json;
  readonly since: string;
  readonly selectorChanged: boolean;
};

function laterTime(first: string, second: Json | undefined): string {
  const secondTime = timeOf(second);
  const firstTime = timeOf(first) ?? 0;
  return secondTime !== undefined && secondTime > firstTime ? new Date(secondTime).toISOString() : first;
}

async function startOf(context: ScriptContext, settings: Settings, input: Fields): Promise<Start> {
  const source = textOf(fieldsOf(await called(context, "items-source.describe", {})).source) ?? "";
  const status = fieldsOf(await called(context, "items-store.status", {}));
  const last = listOf(status.sources)
    .map(fieldsOf)
    .find((entry) => entry.source === source);
  const stored = last?.selector ?? null;
  const selectorChanged = stored !== null && canonicalJson(stored) !== canonicalJson(settings.selector);
  const lookbackStart = new Date(Date.now() - settings.lookbackMilliseconds).toISOString();
  const since = laterTime(textOf(input.since) ?? lookbackStart, settings.selector.since);
  return { source, cursor: selectorChanged ? null : (last?.cursor ?? null), since, selectorChanged };
}

function counted(totals: Totals, page: Fields, put: Fields): void {
  const cost = fieldsOf(page.cost);
  totals.pages += 1;
  totals.fetched += listOf(page.items).length;
  totals.added += numberOf(put.added);
  totals.updated += numberOf(put.updated);
  totals.skipped += listOf(put.skipped).length;
  totals.items += numberOf(cost.items);
  totals.usd = Math.round((totals.usd + numberOf(cost.usd)) * 1e9) / 1e9;
}

async function storedPage(context: ScriptContext, settings: Settings, page: Fields): Promise<Fields> {
  const { source, kinds, items, cursor, cost } = page;
  const put = { source: source ?? null, kinds: kinds ?? [], items: items ?? [], cursor: cursor ?? null };
  return fieldsOf(
    await called(context, "items-store.put", { ...put, cost: cost ?? null, selector: settings.selector }),
  );
}

export const run = defineScript(async (input, context) => {
  const settings = settingsOf(context.settings);
  const start = await startOf(context, settings, fieldsOf(input));
  const totals: Totals = { pages: 0, fetched: 0, added: 0, updated: 0, skipped: 0, items: 0, usd: 0 };
  let cursor = start.cursor;
  let more = true;
  while (more && totals.fetched < settings.maxItems) {
    const selector = { ...settings.selector, since: start.since, limit: settings.maxItems - totals.fetched };
    const page = fieldsOf(await called(context, "items-source.fetch", { selector, cursor }));
    counted(totals, page, await storedPage(context, settings, page));
    cursor = page.cursor ?? null;
    more = page.more === true;
  }
  const { items, usd, ...counts } = totals;
  return {
    source: start.source,
    ...counts,
    cost: { items, usd },
    cursor,
    more,
    selectorChanged: start.selectorChanged,
  };
});
