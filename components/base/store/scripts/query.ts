import { defineScript, fail } from "../../../../bay/sdk.ts";
import { itemOfRow } from "./lib/items.ts";
import { fieldsOf, textOf } from "./lib/json.ts";
import { openPartition } from "./lib/partition.ts";
import { searchExpression, searchWords } from "./lib/search.ts";
import { matches, selectorOf, type Selector } from "./lib/selector.ts";
import { queryNewestFirst, queryOldestFirst } from "./lib/statements.ts";

const defaultLimit = 100;

function searchOf(search: string | undefined): string | null {
  if (search === undefined) {
    return null;
  }
  const words = searchWords(search);
  if (words.length === 0) {
    return fail(`The search ${JSON.stringify(search)} has no letters or digits to look for; give at least one word.`);
  }
  return searchExpression(words);
}

function filterOf(selector: Selector, search: string | null): Readonly<Record<string, string | number | null>> {
  return {
    since: selector.since ?? null,
    until: selector.until ?? null,
    kinds: selector.kinds.length === 0 ? null : JSON.stringify(selector.kinds),
    search,
  };
}

export const run = defineScript(async (input, context) => {
  const request = fieldsOf(input);
  const selector = selectorOf(request.selector);
  const search = textOf(request.search);
  const statement = textOf(request.order) === "oldest" ? queryOldestFirst : queryNewestFirst;
  const partition = await openPartition(context);
  const answer = await partition.query(statement, filterOf(selector, searchOf(search)));
  if (!answer.ok) {
    return fail(`The query could not be run: ${answer.message}`);
  }
  const found = answer.value.map((row) => itemOfRow(row)).filter((item) => matches(selector, item));
  const limit = selector.limit ?? defaultLimit;
  return { items: found.slice(0, limit), more: found.length > limit };
});
