import { fileURLToPath } from "node:url";
import type { ChildEnd, ChildProcesses } from "../ports.ts";
import type { Json } from "../contracts.ts";
import { databaseLockWaitMilliseconds } from "../database-lock.ts";
import { isJson, parsedLine } from "../protocol-json.ts";
import { isRecord } from "../json.ts";
import type { AgentQueryResult } from "../sdk.ts";

export type AgentQueryLimits = {
  readonly rows: number;
  readonly resultBytes: number;
  readonly milliseconds: number;
};

export type AgentQueryOutcome =
  | { readonly status: "done"; readonly value: AgentQueryResult }
  | { readonly status: "refused"; readonly reason: string }
  | { readonly status: "timed-out" }
  | { readonly status: "failed"; readonly message: string };

export type AgentQueryOrder = {
  readonly databaseFile: string;
  readonly sql: string;
  readonly limits: AgentQueryLimits;
};

const queryChildFile = fileURLToPath(new URL("query-child.ts", import.meta.url));

const replyBytes = 64 * 1024 * 1024;

function isRow(value: unknown): value is readonly Json[] {
  return Array.isArray(value) && value.every((cell: unknown) => isJson(cell));
}

function isColumns(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((name: unknown) => typeof name === "string");
}

function outcomeOfReply(line: string | undefined, end: ChildEnd): AgentQueryOutcome {
  if (end.how === "timed-out") {
    return { status: "timed-out" };
  }
  const reply = line === undefined ? undefined : parsedLine(line);
  if (!isRecord(reply)) {
    return { status: "failed", message: `The query process ended without a reply (${end.how}). ${end.errorOutput}` };
  }
  if (reply.ok === true && isColumns(reply.columns) && Array.isArray(reply.rows) && reply.rows.every(isRow)) {
    return { status: "done", value: { columns: reply.columns, rows: reply.rows } };
  }
  if (reply.ok === false && typeof reply.reason === "string") {
    return { status: "refused", reason: reply.reason };
  }
  return { status: "failed", message: "The query process sent a reply that is not well formed." };
}

export async function runAgentQuery(children: ChildProcesses, order: AgentQueryOrder): Promise<AgentQueryOutcome> {
  let reply: string | undefined;
  const child = children.start(
    {
      command: process.execPath,
      arguments: [
        "--permission",
        `--allow-fs-read=${queryChildFile}`,
        `--allow-fs-read=${order.databaseFile}`,
        "--disable-warning=ExperimentalWarning",
        queryChildFile,
      ],
      directory: "/",
      environment: {},
      timeoutMilliseconds: order.limits.milliseconds,
      maximumOutputBytes: replyBytes,
    },
    (line) => {
      reply ??= line;
    },
  );
  child.send(
    JSON.stringify({
      file: order.databaseFile,
      sql: order.sql,
      rows: order.limits.rows,
      resultBytes: order.limits.resultBytes,
      lockWaitMilliseconds: databaseLockWaitMilliseconds,
    }),
  );
  const end = await child.ended;
  return outcomeOfReply(reply, end);
}
