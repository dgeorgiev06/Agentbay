import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

type QueryOrder = {
  readonly file: string;
  readonly sql: string;
  readonly rows: number;
  readonly cellCharacters: number;
  readonly resultBytes: number;
};

type QueryReply =
  | { readonly ok: true; readonly columns: readonly string[]; readonly rows: readonly (readonly unknown[])[] }
  | { readonly ok: false; readonly reason: string };

function isOrder(value: unknown): value is QueryOrder {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const order: Readonly<Record<string, unknown>> = { ...value };
  return (
    typeof order.file === "string" &&
    typeof order.sql === "string" &&
    typeof order.rows === "number" &&
    typeof order.cellCharacters === "number" &&
    typeof order.resultBytes === "number"
  );
}

function cell(value: SQLOutputValue, cellCharacters: number): unknown {
  if (value instanceof Uint8Array) {
    return `<blob ${String(value.byteLength)} bytes>`;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.length > cellCharacters) {
    const cut = value.length - cellCharacters;
    return `${value.slice(0, cellCharacters)}…[cut ${String(cut)} characters; select less with substr()]`;
  }
  return value;
}

function runOrder(order: QueryOrder): QueryReply {
  const database = new DatabaseSync(order.file, { readOnly: true });
  database.exec("pragma query_only = on");
  const wrapped = `select * from (\n${order.sql}\n)`;
  const statement = database.prepare(wrapped);
  if (statement.sourceSQL.length < wrapped.length) {
    return { ok: false, reason: "the text holds more than one statement" };
  }
  statement.setReturnArrays(true);
  const columns = statement.columns().map((column) => column.name);
  const rows: unknown[][] = [];
  let bytes = 0;
  for (const row of statement.iterate()) {
    if (rows.length === order.rows) {
      return { ok: false, reason: `the query returns more than ${String(order.rows)} rows` };
    }
    const cells = Object.values(row).map((value) => cell(value, order.cellCharacters));
    bytes += JSON.stringify(cells).length;
    if (bytes > order.resultBytes) {
      return { ok: false, reason: `the result is larger than ${String(order.resultBytes)} bytes` };
    }
    rows.push(cells);
  }
  return { ok: true, columns, rows };
}

function replyTo(text: string): QueryReply {
  try {
    const order: unknown = JSON.parse(text);
    if (!isOrder(order)) {
      return { ok: false, reason: "the query order is malformed" };
    }
    return runOrder(order);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

let received = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  received += chunk;
  const end = received.indexOf("\n");
  if (end >= 0) {
    process.stdin.destroy();
    process.stdout.write(`${JSON.stringify(replyTo(received.slice(0, end)))}\n`);
  }
});
