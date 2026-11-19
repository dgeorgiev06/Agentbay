import { gunzipSync, gzipSync } from "node:zlib";
import { fail, type DatabasePartition, type Json, type ScriptContext } from "../../../../../bay/sdk.ts";
import type { HandedTest } from "./handed-tests.ts";

type PackedTest = {
  readonly path: string;
  readonly packed: string;
};

type Statement = {
  readonly sql: string;
  readonly parameters: readonly Json[];
};

const partitionName = "kept-tests";

const mostTests = 50;

export function packed(text: string): string {
  return gzipSync(Buffer.from(text, "utf8")).toString("base64");
}

export function unpacked(packedText: string): string {
  return gunzipSync(Buffer.from(packedText, "base64")).toString("utf8");
}

function packedTests(tests: readonly HandedTest[]): readonly PackedTest[] {
  return tests.map((test) => ({ path: test.path, packed: packed(test.text) }));
}

function unpackedTests(kept: readonly PackedTest[]): readonly HandedTest[] {
  return kept.map((test) => ({ path: test.path, text: unpacked(test.packed) }));
}

function insertStatement(slice: string, kept: readonly PackedTest[]): Statement {
  const rows = kept.map(() => "(?, ?, ?)").join(", ");
  const parameters = kept.flatMap((test) => [slice, test.path, test.packed]);
  return { sql: `insert into kept_tests (slice, path, packed) values ${rows}`, parameters };
}

async function opened(context: ScriptContext): Promise<DatabasePartition> {
  const partition = context.db.partition(partitionName);
  const migrated = await partition.migrate();
  return migrated.ok ? partition : fail(`forge could not prepare the partition ${partitionName}: ${migrated.message}`);
}

async function executed(partition: DatabasePartition, statement: Statement): Promise<void> {
  const answer = await partition.execute(statement.sql, statement.parameters);
  if (!answer.ok) {
    fail(`forge could not change the partition ${partitionName}: ${answer.message}`);
  }
}

export async function forgetTests(context: ScriptContext, slice: string): Promise<void> {
  await executed(await opened(context), { sql: "delete from kept_tests where slice = ?", parameters: [slice] });
}

export async function keepTests(context: ScriptContext, slice: string, tests: readonly HandedTest[]): Promise<void> {
  await forgetTests(context, slice);
  if (tests.length === 0) {
    return;
  }
  await executed(await opened(context), insertStatement(slice, packedTests(tests)));
}

export async function keptTests(context: ScriptContext, slice: string): Promise<readonly HandedTest[]> {
  const partition = await opened(context);
  const sql = `select path, packed from kept_tests where slice = ? order by path limit ${String(mostTests)}`;
  const rows = await partition.query(sql, [slice]);
  if (!rows.ok) {
    return fail(`forge could not read the partition ${partitionName}: ${rows.message}`);
  }
  const kept = rows.value.map((row) => ({
    path: typeof row.path === "string" ? row.path : "",
    packed: typeof row.packed === "string" ? row.packed : "",
  }));
  return unpackedTests(kept);
}
