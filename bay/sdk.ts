import { createHash } from "node:crypto";
import type { AgentQueryResult } from "./agent-query.ts";
import type { Answer } from "./answers.ts";
import type { CommandRan, CommandRequest, Json } from "./contracts.ts";
import type { ExecuteResult, Row, SqlParameters } from "./database.ts";
import type { HttpRequest, HttpResponse } from "./ports.ts";

export type { Json } from "./contracts.ts";

export type ScriptError = {
  readonly kind: "script-error";
  readonly reason: string;
};

export type Spending = {
  readonly items?: number;
  readonly usd?: number;
  readonly tokens?: number;
};

export type DatabaseStatements = {
  readonly execute: (sql: string, parameters?: SqlParameters) => Promise<Answer<ExecuteResult>>;
  readonly query: (sql: string, parameters?: SqlParameters) => Promise<Answer<readonly Row[]>>;
};

export type DatabasePartition = DatabaseStatements & {
  readonly migrate: () => Promise<Answer<readonly string[]>>;
  readonly agentQuery: (sql: string) => Promise<Answer<AgentQueryResult>>;
};

export type ScriptContext = {
  readonly db: DatabaseStatements & {
    readonly partition: (name: string) => DatabasePartition;
  };
  readonly files: {
    readonly read: (path: string) => Promise<Answer<string>>;
    readonly write: (path: string, text: string) => Promise<Answer<null>>;
    readonly list: (path: string) => Promise<Answer<readonly string[]>>;
    readonly makeFolder: (path: string) => Promise<Answer<null>>;
    readonly link: (path: string, target: string) => Promise<Answer<null>>;
    readonly remove: (path: string) => Promise<Answer<null>>;
  };
  readonly secrets: {
    readonly get: (name: string) => Promise<Answer<string>>;
  };
  readonly http: {
    readonly request: (request: HttpRequest) => Promise<Answer<HttpResponse>>;
  };
  readonly events: {
    readonly emit: (kind: string, detail: Json) => Promise<Answer<null>>;
  };
  readonly commands: {
    readonly run: (request: CommandRequest) => Promise<Answer<CommandRan>>;
  };
  readonly call: (reference: string, input: Json) => Promise<Answer<Json>>;
  readonly settings: Readonly<Record<string, Json>>;
  readonly now: () => Date;
  readonly spend: (spending: Spending) => Promise<Answer<null>>;
  readonly caller: string | undefined;
  readonly skillInput: Json | undefined;
};

export type ScriptHandler = (input: Json, context: ScriptContext) => Promise<Json>;

export type DefinedScript = {
  readonly kind: "agentbay-script";
  readonly handler: ScriptHandler;
};

export type TimeWindow = {
  readonly start: Date;
  readonly end: Date;
};

const isoTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/;

const shortHashDigits = 16;

export function defineScript(handler: ScriptHandler): DefinedScript {
  return { kind: "agentbay-script", handler };
}

export function fail(reason: string): never {
  const cause: ScriptError = { kind: "script-error", reason };
  throw new Error(reason, { cause });
}

function isList(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}

export type JsonFields = { readonly [key: string]: Json };

export function fieldsOf(value: Json): JsonFields {
  return typeof value === "object" && value !== null && !isList(value) ? value : {};
}

export function canonicalJson(value: Json): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`${String(value)} is not a finite number, so it has no JSON form.`);
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (isList(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const members = Object.entries(value)
    .sort(([first], [second]) => (first < second ? -1 : 1))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${members.join(",")}}`;
}

export function shortHash(value: Json): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex").slice(0, shortHashDigits);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

type TimeFields = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly zoneHour: number;
  readonly zoneMinute: number;
};

function dateIsInRange(fields: TimeFields): boolean {
  return (
    fields.month >= 1 && fields.month <= 12 && fields.day >= 1 && fields.day <= daysInMonth(fields.year, fields.month)
  );
}

function clockIsInRange(fields: TimeFields): boolean {
  return fields.hour < 24 && fields.minute < 60 && fields.second < 60 && fields.zoneHour < 24 && fields.zoneMinute < 60;
}

function timeFields(match: RegExpExecArray): TimeFields {
  const field = (group: number): number => Number(match[group] ?? "0");
  return {
    year: field(1),
    month: field(2),
    day: field(3),
    hour: field(4),
    minute: field(5),
    second: field(6),
    zoneHour: field(8),
    zoneMinute: field(9),
  };
}

export function parseIsoTime(text: string): Date | undefined {
  const match = isoTime.exec(text);
  if (match === null) {
    return undefined;
  }
  const fields = timeFields(match);
  if (!dateIsInRange(fields) || !clockIsInRange(fields)) {
    return undefined;
  }
  const time = new Date(text);
  return Number.isNaN(time.getTime()) ? undefined : time;
}

export function isWithinWindow(time: Date, window: TimeWindow): boolean {
  return time.getTime() >= window.start.getTime() && time.getTime() < window.end.getTime();
}
