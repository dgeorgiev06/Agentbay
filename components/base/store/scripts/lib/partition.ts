import { fail, type DatabasePartition, type DatabaseStatements, type ScriptContext } from "../../../../../bay/sdk.ts";
import type { Fields } from "./json.ts";

const ownerPartition = "owner";

function partitionName(context: ScriptContext): string {
  return context.caller ?? ownerPartition;
}

export async function openPartition(context: ScriptContext): Promise<DatabasePartition> {
  const name = partitionName(context);
  const partition = context.db.partition(name);
  const migrated = await partition.migrate();
  if (!migrated.ok) {
    return fail(`The store for ${name} could not be prepared: ${migrated.message}`);
  }
  return partition;
}

export async function rowsOf(
  database: DatabaseStatements,
  sql: string,
  parameters: Fields,
): Promise<readonly Fields[]> {
  const answer = await database.query(sql, parameters);
  if (!answer.ok) {
    return fail(answer.message);
  }
  return answer.value;
}

export async function changesOf(database: DatabaseStatements, sql: string, parameters: Fields): Promise<number> {
  const answer = await database.execute(sql, parameters);
  if (!answer.ok) {
    return fail(answer.message);
  }
  return answer.value.changes;
}

export async function countOf(database: DatabaseStatements, sql: string): Promise<number> {
  const [row] = await rowsOf(database, sql, {});
  const count = row?.count;
  return typeof count === "number" ? count : 0;
}
