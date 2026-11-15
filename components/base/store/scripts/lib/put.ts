import { fail, shortHash, type DatabaseStatements, type Json } from "../../../../../bay/sdk.ts";
import { itemsOf, localSource, rowParameters, type Item } from "./items.ts";
import { fieldsOf, isFields, numberOf, parsedJson, textOf, textsOf, type Fields } from "./json.ts";
import { changesOf, rowsOf } from "./partition.ts";
import { matches, selectorOf } from "./selector.ts";
import {
  recordSpend,
  selectDeletedIds,
  selectExistingIds,
  selectKindsOfOtherSources,
  upsertItem,
  upsertSyncState,
} from "./statements.ts";

type Cost = {
  readonly items: number;
  readonly usd: number;
};

type Put = {
  readonly source: string;
  readonly kinds: readonly string[];
  readonly items: readonly Item[];
  readonly cursor: { readonly given: boolean; readonly value: string | null };
  readonly cost: Cost | undefined;
  readonly selector: Json | undefined;
};

type Skipped = {
  readonly id: string;
  readonly reason: string;
};

function costOf(value: Json | undefined): Cost | undefined {
  if (!isFields(value)) {
    return undefined;
  }
  return { items: numberOf(value.items) ?? 0, usd: numberOf(value.usd) ?? 0 };
}

function putOf(input: Json): Put {
  const fields = fieldsOf(input);
  const cursorGiven = Object.hasOwn(fields, "cursor");
  return {
    source: textOf(fields.source) ?? "",
    kinds: textsOf(fields.kinds),
    items: itemsOf(fields.items),
    cursor: { given: cursorGiven, value: textOf(fields.cursor) ?? null },
    cost: costOf(fields.cost),
    selector: fields.selector,
  };
}

function foreignItemReason(put: Put, item: Item): string | undefined {
  if (item.source !== put.source) {
    const given = `The item ${item.id} has the source ${item.source}`;
    return `${given}, but this put is for ${put.source}; put each source on its own.`;
  }
  if (!item.id.startsWith(`${put.source}:`)) {
    return `The item id ${item.id} does not start with ${put.source}:; an item id is <source>:<external id>.`;
  }
  if (!put.kinds.includes(item.kind)) {
    const produced = put.kinds.join(", ");
    const given = `The item ${item.id} is a ${item.kind}`;
    return `${given}, which the source ${put.source} does not produce (it produces: ${produced}).`;
  }
  return undefined;
}

function refuseForeignItems(put: Put): void {
  const reasons = put.items.flatMap((item) => foreignItemReason(put, item) ?? []);
  if (reasons.length > 0) {
    fail(`Nothing was stored. ${reasons.join(" ")}`);
  }
}

async function refuseKindsOfSources(database: DatabaseStatements, put: Put): Promise<void> {
  if (put.source !== localSource) {
    return;
  }
  for (const row of await rowsOf(database, selectKindsOfOtherSources, { source: put.source })) {
    const produced = textsOf(parsedJson(textOf(row.kinds) ?? "[]"));
    const taken = put.kinds.filter((kind) => produced.includes(kind));
    if (taken.length > 0) {
      const source = textOf(row.source) ?? "";
      fail(
        `Nothing was stored. A local item may not be a ${taken.join(" or ")}: the source ${source} produces ` +
          "that kind, and its items arrive by sync.",
      );
    }
  }
}

function pageOf(put: Put): string {
  const ids = put.items.map((item) => item.id);
  const cost = put.cost === undefined ? null : { items: put.cost.items, usd: put.cost.usd };
  return shortHash({ source: put.source, cursor: put.cursor.value, cost, ids });
}

async function recordCost(database: DatabaseStatements, put: Put, now: Date): Promise<void> {
  const cost = put.cost;
  if (cost === undefined || (cost.items === 0 && cost.usd === 0)) {
    return;
  }
  const spend = {
    page: pageOf(put),
    source: put.source,
    month: now.toISOString().slice(0, 7),
    items: cost.items,
    usd: cost.usd,
    recorded_at: now.toISOString(),
  };
  await changesOf(database, recordSpend, spend);
}

async function idsIn(database: DatabaseStatements, sql: string, items: readonly Item[]): Promise<ReadonlySet<string>> {
  const ids = JSON.stringify(items.map((item) => item.id));
  const rows = await rowsOf(database, sql, { ids });
  return new Set(rows.flatMap((row) => textOf(row.id) ?? []));
}

async function saveSyncState(database: DatabaseStatements, put: Put, now: Date): Promise<void> {
  const state: Fields = {
    source: put.source,
    kinds: JSON.stringify(put.kinds),
    cursor: put.cursor.value,
    keep_cursor: put.cursor.given ? 0 : 1,
    last_sync: now.toISOString(),
    selector: put.selector === undefined ? null : JSON.stringify(put.selector),
  };
  await changesOf(database, upsertSyncState, state);
}

function skipReason(put: Put, item: Item, deleted: ReadonlySet<string>): string | undefined {
  if (deleted.has(item.id)) {
    return `${item.id} was deleted from the store, so it is never stored again.`;
  }
  if (put.selector !== undefined && !matches(selectorOf(put.selector), item)) {
    return `${item.id} does not match the selector it was fetched with, so it is not kept.`;
  }
  return undefined;
}

export async function putItems(database: DatabaseStatements, input: Json, now: Date): Promise<Json> {
  const put = putOf(input);
  refuseForeignItems(put);
  await refuseKindsOfSources(database, put);
  await recordCost(database, put, now);
  const deleted = await idsIn(database, selectDeletedIds, put.items);
  const stored = new Set(await idsIn(database, selectExistingIds, put.items));
  const skipped: Skipped[] = [];
  let added = 0;
  let updated = 0;
  for (const item of put.items) {
    const reason = skipReason(put, item, deleted);
    if (reason !== undefined) {
      skipped.push({ id: item.id, reason });
      continue;
    }
    await changesOf(database, upsertItem, rowParameters(item, now.toISOString()));
    if (stored.has(item.id)) {
      updated += 1;
    } else {
      added += 1;
      stored.add(item.id);
    }
  }
  await saveSyncState(database, put, now);
  return { added, updated, skipped };
}
