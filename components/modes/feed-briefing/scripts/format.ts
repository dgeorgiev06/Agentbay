import { defineScript, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { called } from "./lib/calls.ts";
import { fieldsOf, listOf, textOf, textsOf, type Fields } from "./lib/json.ts";

function sourceOf(value: Json): readonly [string, Json] {
  const item = fieldsOf(value);
  const id = textOf(item.id) ?? "";
  return [id, { id, author: textOf(item.author) ?? null, at: textOf(item.at) ?? "", url: textOf(item.url) ?? null }];
}

async function storedSources(context: ScriptContext, ids: readonly string[]): Promise<Map<string, Json>> {
  if (ids.length === 0) {
    return new Map();
  }
  const found = fieldsOf(await called(context, "items-store.get", { ids }));
  return new Map(listOf(found.items).map(sourceOf));
}

function themeOf(theme: Fields, sources: ReadonlyMap<string, Json>): Json {
  return {
    title: textOf(theme.title) ?? "",
    summary: textOf(theme.summary) ?? "",
    sources: textsOf(theme.cites).flatMap((id) => sources.get(id) ?? []),
  };
}

export const run = defineScript(async (input, context) => {
  const draft = fieldsOf(input);
  const themes = listOf(draft.themes).map(fieldsOf);
  const cited = [...new Set(themes.flatMap((theme) => textsOf(theme.cites)))];
  const sources = await storedSources(context, cited);
  return {
    period: draft.period ?? null,
    selectorChanged: draft.selectorChanged === true,
    themes: themes.map((theme) => themeOf(theme, sources)),
    notes: textOf(draft.notes) ?? null,
    cited: cited.filter((id) => sources.has(id)).length,
  };
});
