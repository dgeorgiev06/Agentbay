import { gunzipSync, gzipSync } from "node:zlib";
import {
  fail,
  readYaml,
  type DatabasePartition,
  type Json,
  type Row,
  type ScriptContext,
} from "../../../../../bay/sdk.ts";
import type { HandedTest } from "./handed-tests.ts";
import { marked, markOf, withoutMark } from "./mark.ts";
import { reviewOf, type Finding } from "./review.ts";
import { textOf } from "./json-values.ts";

type PackedTest = {
  readonly path: string;
  readonly packed: string;
};

type Keeping = {
  readonly slice: string;
  readonly tests: readonly HandedTest[];
  readonly mark: string;
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

function packedTests(tests: readonly HandedTest[], mark: string): readonly PackedTest[] {
  return tests.map((test) => ({ path: test.path, packed: packed(marked(test.text, mark)) }));
}

function unpackedTests(kept: readonly PackedTest[]): readonly HandedTest[] {
  return kept.map((test) => ({ path: test.path, text: withoutMark(unpacked(test.packed)) }));
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

async function rowsOf(partition: DatabasePartition, statement: Statement): Promise<readonly Row[]> {
  const rows = await partition.query(statement.sql, statement.parameters);
  return rows.ok ? rows.value : fail(`forge could not read the partition ${partitionName}: ${rows.message}`);
}

export async function forgetKept(context: ScriptContext, slice: string): Promise<void> {
  const partition = await opened(context);
  await executed(partition, { sql: "delete from kept_tests where slice = ?", parameters: [slice] });
  await executed(partition, { sql: "delete from kept_findings where slice = ?", parameters: [slice] });
}

function byPath(tests: readonly HandedTest[]): readonly HandedTest[] {
  return [...tests].sort((first, second) => (first.path < second.path ? -1 : 1));
}

function sameTests(kept: readonly HandedTest[], tests: readonly HandedTest[]): boolean {
  const sorted = byPath(tests);
  const same = (test: HandedTest, at: number): boolean =>
    test.path === sorted[at]?.path && test.text === sorted[at].text;
  return kept.length === sorted.length && kept.every(same);
}

export async function keepTests(context: ScriptContext, keeping: Keeping): Promise<void> {
  const { slice, tests, mark } = keeping;
  if (sameTests(await keptTests(context, slice), tests)) {
    return;
  }
  const partition = await opened(context);
  await executed(partition, { sql: "delete from kept_tests where slice = ?", parameters: [slice] });
  if (tests.length === 0) {
    return;
  }
  await executed(partition, insertStatement(slice, packedTests(tests, mark)));
}

export async function keepFindings(context: ScriptContext, slice: string, findings: readonly Finding[]): Promise<void> {
  const partition = await opened(context);
  await executed(partition, { sql: "delete from kept_findings where slice = ?", parameters: [slice] });
  if (findings.length === 0) {
    return;
  }
  const statement = "insert into kept_findings (slice, packed) values (?, ?)";
  await executed(partition, { sql: statement, parameters: [slice, packed(JSON.stringify(findings))] });
}

export async function keptFindings(context: ScriptContext, slice: string): Promise<readonly Finding[]> {
  const sql = "select packed from kept_findings where slice = ? limit 1";
  const [row] = await rowsOf(await opened(context), { sql, parameters: [slice] });
  if (row === undefined) {
    return [];
  }
  const read = readYaml(unpacked(textOf(row.packed)));
  return read.ok ? reviewOf({ findings: read.value }).findings : fail("forge could not unpack the kept findings.");
}

export async function keptTests(context: ScriptContext, slice: string): Promise<readonly HandedTest[]> {
  const sql = `select path, packed from kept_tests where slice = ? order by path limit ${String(mostTests)}`;
  const rows = await rowsOf(await opened(context), { sql, parameters: [slice] });
  return unpackedTests(rows.map((row) => ({ path: textOf(row.path), packed: textOf(row.packed) })));
}

export async function keptMark(context: ScriptContext, slice: string): Promise<string | undefined> {
  const sql = "select packed from kept_tests where slice = ? order by path limit 1";
  const [row] = await rowsOf(await opened(context), { sql, parameters: [slice] });
  return row === undefined ? undefined : markOf(unpacked(textOf(row.packed)));
}
