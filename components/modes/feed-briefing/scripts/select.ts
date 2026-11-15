import { canonicalJson, defineScript, parseIsoTime, type Json } from "../../../../bay/sdk.ts";
import { called } from "./lib/calls.ts";
import { fieldsOf, listOf, textOf, textsOf, type Fields } from "./lib/json.ts";
import { digestLimits } from "./lib/limits.ts";
import { settingsOf, timeOf, type Settings } from "./lib/settings.ts";

const excerptCharacters = 400;

function windowOf(input: Fields, settings: Settings, now: Date): { since: string; until: string } {
  const selector = settings.selector;
  const asked = parseIsoTime(textOf(input.until) ?? "")?.getTime() ?? now.getTime();
  const until = Math.min(asked, timeOf(selector.until) ?? asked);
  const since = Math.max(asked - settings.lookbackMilliseconds, timeOf(selector.since) ?? 0);
  return { since: new Date(since).toISOString(), until: new Date(until).toISOString() };
}

function excerptOf(item: Fields): string {
  const title = textOf(item.title);
  const text = textOf(item.text) ?? "";
  const whole = title === undefined ? text : `${title}: ${text}`;
  return whole.length <= excerptCharacters ? whole : `${whole.slice(0, excerptCharacters - 1)}…`;
}

function selectedOf(value: Json): Json {
  const item = fieldsOf(value);
  return {
    id: textOf(item.id) ?? "",
    at: textOf(item.at) ?? "",
    author: textOf(item.author) ?? null,
    labels: textsOf(item.labels),
    url: textOf(item.url) ?? null,
    excerpt: excerptOf(item),
  };
}

function hasSelectorChanged(status: Fields, selector: Fields): boolean {
  return listOf(status.sources)
    .map((entry) => fieldsOf(entry).selector ?? null)
    .some((stored) => stored !== null && canonicalJson(stored) !== canonicalJson(selector));
}

export const run = defineScript(async (input, context) => {
  const request = fieldsOf(input);
  const settings = settingsOf(context.settings);
  const period = windowOf(request, settings, context.now());
  const selector = { ...settings.selector, ...period, limit: settings.maxItems };
  const found = fieldsOf(await called(context, "items-store.query", { selector, order: "oldest" }));
  const status = fieldsOf(await called(context, "items-store.status", {}));
  return {
    period,
    focus: textOf(request.focus) ?? null,
    selectorChanged: hasSelectorChanged(status, settings.selector),
    more: found.more === true,
    limits: digestLimits,
    items: listOf(found.items).map(selectedOf),
  };
});
