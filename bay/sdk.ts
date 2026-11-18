import { createHash } from "node:crypto";
import type { Answer } from "./answers.ts";
import type { Json } from "./contracts.ts";
import type { SchemaCheck } from "./value-check.ts";

export type { Json } from "./contracts.ts";

export { readYaml } from "./yaml-text.ts";

export type ScriptError = {
  readonly kind: "script-error";
  readonly reason: string;
};

export type Spending = {
  readonly items?: number;
  readonly usd?: number;
  readonly tokens?: number;
};

export type SqlParameters = readonly Json[] | Readonly<Record<string, Json>>;

export type Row = Readonly<Record<string, Json>>;

export type ExecuteResult = {
  readonly changes: number;
  readonly lastInsertRowid: number;
};

export type AgentQueryResult = {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly Json[])[];
};

export type HttpRequest = {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
};

export type HttpResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

export type CommandRequest = {
  readonly name: string;
  readonly arguments: readonly string[];
  readonly folder: string;
  readonly timeLimitSeconds: number;
  readonly input?: string;
};

export type CommandEnd =
  | { readonly how: "exited"; readonly exitCode: number }
  | { readonly how: "signalled"; readonly signal: string }
  | { readonly how: "timed-out" };

export type CommandOutput = {
  readonly text: string;
  readonly cut: boolean;
};

export type CommandRan = {
  readonly end: CommandEnd;
  readonly milliseconds: number;
  readonly stdout: CommandOutput;
  readonly stderr: CommandOutput;
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
  readonly schemas: {
    readonly check: (schema: string, value: Json) => Promise<Answer<SchemaCheck>>;
  };
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

export type PathMatch =
  | { readonly kind: "matched" }
  | { readonly kind: "not matched" }
  | { readonly kind: "not a pattern"; readonly reason: string }
  | { readonly kind: "not a path"; readonly reason: string };

const longestPattern = 1000;

const patternCharacters = /^[A-Za-z0-9_.*/-]*$/;

const anyFolders = "**";

const onlyStars = /^\**$/;

function patternFault(pattern: string): string | undefined {
  if (pattern === "") {
    return "it is empty";
  }
  if (pattern.length > longestPattern) {
    return `it is longer than ${String(longestPattern)} characters`;
  }
  if (!patternCharacters.test(pattern)) {
    return "it holds a character other than a letter, a digit, _, ., *, / and -";
  }
  if (pattern.startsWith("/") || pattern.startsWith("-")) {
    return `it starts with ${pattern.charAt(0)}`;
  }
  if (pattern.endsWith("/")) {
    return "it ends with /";
  }
  if (pattern.includes("//")) {
    return "it holds two slashes in a row";
  }
  if (pattern.includes("..")) {
    return "it holds two dots in a row";
  }
  return undefined;
}

function pathFault(parts: readonly string[], path: string): string | undefined {
  if (path.startsWith("/")) {
    return "it starts with /, and a path is relative to the repository's root";
  }
  if (parts.includes("")) {
    return parts.length === 1 ? "it is empty" : "it holds two slashes in a row";
  }
  if (parts.includes("..")) {
    return "it holds .. as a part";
  }
  return parts.length === 0 ? "it names no file" : undefined;
}

function pathParts(path: string): readonly string[] {
  const parts = path.split("/");
  const named = parts.length > 1 && parts.at(-1) === "" ? parts.slice(0, -1) : parts;
  return named.filter((part) => part !== ".");
}

function nameMatches(pattern: string, name: string): boolean {
  let patternAt = 0;
  let nameAt = 0;
  let star = -1;
  let starNameAt = 0;
  while (nameAt < name.length) {
    if (pattern.charAt(patternAt) === "*") {
      star = patternAt;
      starNameAt = nameAt;
      patternAt += 1;
    } else if (patternAt < pattern.length && pattern.charAt(patternAt) === name.charAt(nameAt)) {
      patternAt += 1;
      nameAt += 1;
    } else if (star >= 0) {
      starNameAt += 1;
      patternAt = star + 1;
      nameAt = starNameAt;
    } else {
      return false;
    }
  }
  return onlyStars.test(pattern.slice(patternAt));
}

function afterAnyFolders(reached: readonly boolean[], atLeastOne: boolean): readonly boolean[] {
  let reachedBefore = false;
  return reached.map((here) => {
    const next = reachedBefore || (here && !atLeastOne);
    reachedBefore ||= here;
    return next;
  });
}

function afterName(reached: readonly boolean[], part: string, names: readonly string[]): readonly boolean[] {
  return reached.map(
    (_, index) => index > 0 && reached[index - 1] === true && nameMatches(part, names[index - 1] ?? ""),
  );
}

function partsMatch(pattern: readonly string[], names: readonly string[]): boolean {
  let reached: readonly boolean[] = [true, ...names.map(() => false)];
  for (const [index, part] of pattern.entries()) {
    const last = index === pattern.length - 1;
    reached = part === anyFolders ? afterAnyFolders(reached, last) : afterName(reached, part, names);
  }
  return reached.at(-1) === true;
}

export function pathMatch(pattern: string, path: string): PathMatch {
  const patternProblem = patternFault(pattern);
  if (patternProblem !== undefined) {
    return { kind: "not a pattern", reason: `${JSON.stringify(pattern)} is not a pattern: ${patternProblem}.` };
  }
  const names = pathParts(path);
  const pathProblem = pathFault(names, path);
  if (pathProblem !== undefined) {
    return { kind: "not a path", reason: `${JSON.stringify(path)} is not a path: ${pathProblem}.` };
  }
  return partsMatch(pathParts(pattern), names) ? { kind: "matched" } : { kind: "not matched" };
}
