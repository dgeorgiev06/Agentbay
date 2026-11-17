import type { Json } from "../contracts.ts";
import { type DatabaseResult, type Migration, ModeDatabase } from "./database.ts";
import type { SqlParameters } from "../sdk.ts";
import { isJsonRecord, parsedLine } from "../protocol-json.ts";

type Order =
  | { readonly id: number; readonly method: "query"; readonly sql: string; readonly parameters: SqlParameters }
  | {
      readonly id: number;
      readonly method: "execute";
      readonly sql: string;
      readonly parameters: SqlParameters;
      readonly writable: boolean;
    }
  | {
      readonly id: number;
      readonly method: "migrate";
      readonly migrations: readonly Migration[];
      readonly appliedAt: string;
    };

const database = new ModeDatabase(process.argv[2] ?? "");

function isParameters(value: Json | undefined): value is SqlParameters {
  return Array.isArray(value) || isJsonRecord(value);
}

function isMigrations(value: Json | undefined): value is readonly Migration[] {
  return (
    Array.isArray(value) &&
    value.every((item: Json) => isJsonRecord(item) && typeof item.name === "string" && typeof item.sql === "string")
  );
}

function statementOrderOf(id: number, fields: { readonly [key: string]: Json }): Order | undefined {
  const { method, sql, parameters, writable } = fields;
  if (typeof sql !== "string" || !isParameters(parameters)) {
    return undefined;
  }
  if (method === "query") {
    return { id, method, sql, parameters };
  }
  return method === "execute" && typeof writable === "boolean" ? { id, method, sql, parameters, writable } : undefined;
}

function orderOf(line: string): Order | undefined {
  const value = parsedLine(line);
  if (!isJsonRecord(value) || typeof value.id !== "number") {
    return undefined;
  }
  const { id, method, migrations, appliedAt } = value;
  if (method === "migrate" && isMigrations(migrations) && typeof appliedAt === "string") {
    return { id, method, migrations, appliedAt };
  }
  return statementOrderOf(id, value);
}

function resultOf(order: Order): DatabaseResult<Json> {
  switch (order.method) {
    case "query":
      return database.query(order.sql, order.parameters);
    case "execute":
      return database.execute(order.sql, order.parameters, order.writable ? "writable" : "read-only");
    case "migrate":
      return database.applyMigrations(order.migrations, order.appliedAt);
  }
}

function answer(line: string): void {
  const order = orderOf(line);
  if (order === undefined) {
    process.stdout.write(`${JSON.stringify({ id: -1, result: { status: "error", message: "malformed order" } })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ id: order.id, result: resultOf(order) })}\n`);
}

let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  const lines = (pending + chunk).split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) {
    answer(line);
  }
});
process.stdin.on("end", () => {
  database.close();
});
