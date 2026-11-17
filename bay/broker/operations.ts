import type { Answer, Resource } from "../answers.ts";
import type { Json } from "../contracts.ts";
import { isJson, isJsonRecord } from "../protocol-json.ts";
import type {
  AgentQueryResult,
  CommandEnd,
  CommandOutput,
  CommandRan,
  CommandRequest,
  DatabasePartition,
  ExecuteResult,
  HttpRequest,
  HttpResponse,
  Row,
  ScriptContext,
  SqlParameters,
} from "../sdk.ts";

type StatementRequest = {
  readonly sql: string;
  readonly parameters: SqlParameters;
  readonly partition?: string;
};

type PathRequest = { readonly path: string };

export type Requests = {
  readonly "db.execute": StatementRequest;
  readonly "db.query": StatementRequest;
  readonly "db.migrate": { readonly partition: string };
  readonly "db.agentQuery": { readonly sql: string; readonly partition?: string };
  readonly "files.read": PathRequest;
  readonly "files.list": PathRequest;
  readonly "files.write": { readonly path: string; readonly text: string };
  readonly "files.makeFolder": PathRequest;
  readonly "files.link": { readonly path: string; readonly target: string };
  readonly "files.remove": PathRequest;
  readonly "secrets.get": { readonly name: string };
  readonly "http.request": HttpRequest;
  readonly "events.emit": { readonly kind: string; readonly detail: Json };
  readonly call: { readonly reference: string; readonly input: Json };
  readonly spend: { readonly spending: Json };
  readonly "commands.run": CommandRequest;
};

export type Results = {
  readonly "db.execute": ExecuteResult;
  readonly "db.query": readonly Row[];
  readonly "db.migrate": readonly string[];
  readonly "db.agentQuery": AgentQueryResult;
  readonly "files.read": string;
  readonly "files.list": readonly string[];
  readonly "files.write": null;
  readonly "files.makeFolder": null;
  readonly "files.link": null;
  readonly "files.remove": null;
  readonly "secrets.get": string;
  readonly "http.request": HttpResponse;
  readonly "events.emit": null;
  readonly call: Json;
  readonly spend: null;
  readonly "commands.run": CommandRan;
};

export type OperationName = keyof Requests;

const httpMethods: readonly string[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const commandEnds: readonly string[] = ["exited", "signalled", "timed-out"];

export function isText(value: Json | undefined): value is string {
  return typeof value === "string";
}

function isStringRecord(value: Json | undefined): value is { readonly [key: string]: string } {
  return isJsonRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isParameters(value: Json | undefined): value is SqlParameters {
  return Array.isArray(value) || isJsonRecord(value);
}

function isHttpMethod(value: Json | undefined): value is HttpRequest["method"] {
  return typeof value === "string" && httpMethods.includes(value);
}

function isList(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}

type FieldPath = readonly (string | number)[];

export type Misfit =
  | { readonly found: "missing" | "unlike"; readonly path: FieldPath; readonly expected: string }
  | { readonly found: "unknown"; readonly path: FieldPath; readonly taken: readonly string[] };

export type Reading<Value> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly misfit: Misfit };

export type Shape<Name extends OperationName> = {
  readonly resource: Resource;
  readonly request: (value: Json) => Reading<Requests[Name]>;
  readonly result: (value: Json) => Reading<Results[Name]>;
};

type Fields = { readonly [key: string]: Json };

type ListOf<Item extends Json> = {
  readonly list: string;
  readonly item: string;
  readonly isItem: (item: Json) => item is Item;
};

const listOfText: ListOf<string> = { list: "a list of text", item: "text", isItem: isText };

const listOfRows: ListOf<Row> = { list: "a list of rows", item: "a row", isItem: isJsonRecord };

const listOfLists: ListOf<readonly Json[]> = { list: "a list of lists", item: "a list", isItem: isList };

function read<Value>(value: Value): Reading<Value> {
  return { ok: true, value };
}

function misfitAt(path: FieldPath, given: Json | undefined, expected: string): Reading<never> {
  return { ok: false, misfit: { found: given === undefined ? "missing" : "unlike", path, expected } };
}

function fieldsOf(value: Json, taken: readonly string[]): Reading<Fields> {
  if (!isJsonRecord(value)) {
    return misfitAt([], value, "a mapping");
  }
  const unknown = Object.keys(value).find((name) => !taken.includes(name));
  return unknown === undefined ? read(value) : { ok: false, misfit: { found: "unknown", path: [unknown], taken } };
}

function listAt<Item extends Json>(
  path: FieldPath,
  value: Json | undefined,
  shape: ListOf<Item>,
): Reading<readonly Item[]> {
  if (value === undefined || !isList(value)) {
    return misfitAt(path, value, shape.list);
  }
  const index = value.findIndex((item) => !shape.isItem(item));
  return index < 0 ? read(value.filter(shape.isItem)) : misfitAt([...path, index], value[index], shape.item);
}

function textMappingAt(path: FieldPath, value: Json | undefined): Reading<{ readonly [key: string]: string }> {
  if (isStringRecord(value)) {
    return read(value);
  }
  if (!isJsonRecord(value)) {
    return misfitAt(path, value, "a mapping of text to text");
  }
  const [name = "", item = null] = Object.entries(value).find(([, given]) => !isText(given)) ?? [];
  return misfitAt([...path, name], item, "text");
}

function statementRequestOf(value: Json): Reading<StatementRequest> {
  const fields = fieldsOf(value, ["sql", "parameters", "partition"]);
  if (!fields.ok) {
    return fields;
  }
  const { sql, parameters, partition } = fields.value;
  if (!isText(sql)) {
    return misfitAt(["sql"], sql, "text");
  }
  if (!isParameters(parameters)) {
    return misfitAt(["parameters"], parameters, "a list or a mapping");
  }
  if (partition === undefined) {
    return read({ sql, parameters });
  }
  return isText(partition) ? read({ sql, parameters, partition }) : misfitAt(["partition"], partition, "text");
}

function migrateRequestOf(value: Json): Reading<Requests["db.migrate"]> {
  const fields = fieldsOf(value, ["partition"]);
  if (!fields.ok) {
    return fields;
  }
  const { partition } = fields.value;
  return isText(partition) ? read({ partition }) : misfitAt(["partition"], partition, "text");
}

function agentQueryRequestOf(value: Json): Reading<Requests["db.agentQuery"]> {
  const fields = fieldsOf(value, ["sql", "partition"]);
  if (!fields.ok) {
    return fields;
  }
  const { sql, partition } = fields.value;
  if (!isText(sql)) {
    return misfitAt(["sql"], sql, "text");
  }
  if (partition === undefined) {
    return read({ sql });
  }
  return isText(partition) ? read({ sql, partition }) : misfitAt(["partition"], partition, "text");
}

function pathRequestOf(value: Json): Reading<PathRequest> {
  const fields = fieldsOf(value, ["path"]);
  if (!fields.ok) {
    return fields;
  }
  const { path } = fields.value;
  return isText(path) ? read({ path }) : misfitAt(["path"], path, "text");
}

function writeRequestOf(value: Json): Reading<Requests["files.write"]> {
  const fields = fieldsOf(value, ["path", "text"]);
  if (!fields.ok) {
    return fields;
  }
  const { path, text } = fields.value;
  if (!isText(path)) {
    return misfitAt(["path"], path, "text");
  }
  return isText(text) ? read({ path, text }) : misfitAt(["text"], text, "text");
}

function linkRequestOf(value: Json): Reading<Requests["files.link"]> {
  const fields = fieldsOf(value, ["path", "target"]);
  if (!fields.ok) {
    return fields;
  }
  const { path, target } = fields.value;
  if (!isText(path)) {
    return misfitAt(["path"], path, "text");
  }
  return isText(target) ? read({ path, target }) : misfitAt(["target"], target, "text");
}

function secretRequestOf(value: Json): Reading<Requests["secrets.get"]> {
  const fields = fieldsOf(value, ["name"]);
  if (!fields.ok) {
    return fields;
  }
  const { name } = fields.value;
  return isText(name) ? read({ name }) : misfitAt(["name"], name, "text");
}

function httpRequestOf(value: Json): Reading<HttpRequest> {
  const fields = fieldsOf(value, ["method", "url", "headers", "body"]);
  if (!fields.ok) {
    return fields;
  }
  const { method, url, body } = fields.value;
  if (!isHttpMethod(method)) {
    return misfitAt(["method"], method, `one of ${httpMethods.join(", ")}`);
  }
  if (!isText(url)) {
    return misfitAt(["url"], url, "text");
  }
  const headers = textMappingAt(["headers"], fields.value.headers);
  if (!headers.ok) {
    return headers;
  }
  if (body === undefined) {
    return read({ method, url, headers: headers.value });
  }
  return isText(body) ? read({ method, url, headers: headers.value, body }) : misfitAt(["body"], body, "text");
}

function emitRequestOf(value: Json): Reading<Requests["events.emit"]> {
  const fields = fieldsOf(value, ["kind", "detail"]);
  if (!fields.ok) {
    return fields;
  }
  const { kind, detail } = fields.value;
  if (!isText(kind)) {
    return misfitAt(["kind"], kind, "text");
  }
  return detail === undefined ? misfitAt(["detail"], detail, "a JSON value") : read({ kind, detail });
}

function callRequestOf(value: Json): Reading<Requests["call"]> {
  const fields = fieldsOf(value, ["reference", "input"]);
  if (!fields.ok) {
    return fields;
  }
  const { reference, input } = fields.value;
  if (!isText(reference)) {
    return misfitAt(["reference"], reference, "text");
  }
  return input === undefined ? misfitAt(["input"], input, "a JSON value") : read({ reference, input });
}

function spendRequestOf(value: Json): Reading<Requests["spend"]> {
  const fields = fieldsOf(value, ["spending"]);
  if (!fields.ok) {
    return fields;
  }
  const { spending } = fields.value;
  return spending === undefined ? misfitAt(["spending"], spending, "a JSON value") : read({ spending });
}

function commandRequestOf(value: Json): Reading<CommandRequest> {
  const fields = fieldsOf(value, ["name", "arguments", "folder", "timeLimitSeconds", "input"]);
  if (!fields.ok) {
    return fields;
  }
  const { name, folder, timeLimitSeconds, input } = fields.value;
  if (!isText(name)) {
    return misfitAt(["name"], name, "text");
  }
  const given = listAt(["arguments"], fields.value.arguments, listOfText);
  if (!given.ok) {
    return given;
  }
  if (!isText(folder)) {
    return misfitAt(["folder"], folder, "text");
  }
  if (typeof timeLimitSeconds !== "number") {
    return misfitAt(["timeLimitSeconds"], timeLimitSeconds, "a number");
  }
  const request = { name, arguments: given.value, folder, timeLimitSeconds };
  if (input === undefined) {
    return read(request);
  }
  return isText(input) ? read({ ...request, input }) : misfitAt(["input"], input, "text");
}

function executeResultOf(value: Json): Reading<ExecuteResult> {
  if (!isJsonRecord(value)) {
    return misfitAt([], value, "a mapping");
  }
  const { changes, lastInsertRowid } = value;
  if (typeof changes !== "number") {
    return misfitAt(["changes"], changes, "a number");
  }
  return typeof lastInsertRowid === "number"
    ? read({ changes, lastInsertRowid })
    : misfitAt(["lastInsertRowid"], lastInsertRowid, "a number");
}

function rowsOf(value: Json): Reading<readonly Row[]> {
  return listAt([], value, listOfRows);
}

function textsOf(value: Json): Reading<readonly string[]> {
  return listAt([], value, listOfText);
}

function agentQueryResultOf(value: Json): Reading<AgentQueryResult> {
  if (!isJsonRecord(value)) {
    return misfitAt([], value, "a mapping");
  }
  const columns = listAt(["columns"], value.columns, listOfText);
  if (!columns.ok) {
    return columns;
  }
  const rows = listAt(["rows"], value.rows, listOfLists);
  return rows.ok ? read({ columns: columns.value, rows: rows.value }) : rows;
}

function textOf(value: Json): Reading<string> {
  return isText(value) ? read(value) : misfitAt([], value, "text");
}

function nothingOf(value: Json): Reading<null> {
  return value === null ? read(value) : misfitAt([], value, "null");
}

function responseOf(value: Json): Reading<HttpResponse> {
  if (!isJsonRecord(value)) {
    return misfitAt([], value, "a mapping");
  }
  const { status, body } = value;
  if (typeof status !== "number") {
    return misfitAt(["status"], status, "a number");
  }
  const headers = textMappingAt(["headers"], value.headers);
  if (!headers.ok) {
    return headers;
  }
  return isText(body) ? read({ status, headers: headers.value, body }) : misfitAt(["body"], body, "text");
}

function anyJsonOf(value: Json): Reading<Json> {
  return isJson(value) ? read(value) : misfitAt([], value, "a JSON value");
}

function commandEndOf(value: Json | undefined): Reading<CommandEnd> {
  if (!isJsonRecord(value)) {
    return misfitAt(["end"], value, "a mapping");
  }
  const { how, exitCode, signal } = value;
  if (how === "timed-out") {
    return read({ how });
  }
  if (how === "exited") {
    return typeof exitCode === "number" ? read({ how, exitCode }) : misfitAt(["end", "exitCode"], exitCode, "a number");
  }
  if (how === "signalled") {
    return isText(signal) ? read({ how, signal }) : misfitAt(["end", "signal"], signal, "text");
  }
  return misfitAt(["end", "how"], how, `one of ${commandEnds.join(", ")}`);
}

function commandOutputOf(name: "stdout" | "stderr", value: Json | undefined): Reading<CommandOutput> {
  if (!isJsonRecord(value)) {
    return misfitAt([name], value, "a mapping");
  }
  const { text, cut } = value;
  if (!isText(text)) {
    return misfitAt([name, "text"], text, "text");
  }
  return typeof cut === "boolean" ? read({ text, cut }) : misfitAt([name, "cut"], cut, "true or false");
}

function commandRanOf(value: Json): Reading<CommandRan> {
  if (!isJsonRecord(value)) {
    return misfitAt([], value, "a mapping");
  }
  const end = commandEndOf(value.end);
  if (!end.ok) {
    return end;
  }
  const { milliseconds } = value;
  if (typeof milliseconds !== "number") {
    return misfitAt(["milliseconds"], milliseconds, "a number");
  }
  const stdout = commandOutputOf("stdout", value.stdout);
  if (!stdout.ok) {
    return stdout;
  }
  const stderr = commandOutputOf("stderr", value.stderr);
  return stderr.ok ? read({ end: end.value, milliseconds, stdout: stdout.value, stderr: stderr.value }) : stderr;
}

export const shapes: { readonly [Name in OperationName]: Shape<Name> } = {
  "db.execute": { resource: "db", request: statementRequestOf, result: executeResultOf },
  "db.query": { resource: "db", request: statementRequestOf, result: rowsOf },
  "db.migrate": { resource: "db", request: migrateRequestOf, result: textsOf },
  "db.agentQuery": { resource: "db", request: agentQueryRequestOf, result: agentQueryResultOf },
  "files.read": { resource: "files", request: pathRequestOf, result: textOf },
  "files.list": { resource: "files", request: pathRequestOf, result: textsOf },
  "files.write": { resource: "files", request: writeRequestOf, result: nothingOf },
  "files.makeFolder": { resource: "files", request: pathRequestOf, result: nothingOf },
  "files.link": { resource: "files", request: linkRequestOf, result: nothingOf },
  "files.remove": { resource: "files", request: pathRequestOf, result: nothingOf },
  "secrets.get": { resource: "secrets", request: secretRequestOf, result: textOf },
  "http.request": { resource: "http", request: httpRequestOf, result: responseOf },
  "events.emit": { resource: "events", request: emitRequestOf, result: nothingOf },
  call: { resource: "call", request: callRequestOf, result: anyJsonOf },
  spend: { resource: "spend", request: spendRequestOf, result: nothingOf },
  "commands.run": { resource: "commands", request: commandRequestOf, result: commandRanOf },
};

export function isOperationName(value: Json | undefined): value is OperationName {
  return typeof value === "string" && Object.hasOwn(shapes, value);
}

export type Misreading = {
  readonly side: "request" | "result";
  readonly operation: OperationName;
  readonly misfit: Misfit;
};

export const notAValidMessage = "The script sent a line that is not a valid message.";

const plainName = /^[A-Za-z_$][\w$]*$/;

function pathPart(part: string | number, index: number): string {
  if (typeof part === "number") {
    return `[${String(part)}]`;
  }
  if (!plainName.test(part)) {
    return `[${JSON.stringify(part)}]`;
  }
  return index === 0 ? part : `.${part}`;
}

function takenWords(taken: readonly string[]): string {
  const last = taken.at(-1) ?? "";
  return taken.length < 2 ? `the field ${last}` : `the fields ${taken.slice(0, -1).join(", ")} and ${last}`;
}

export function shownToAuthor(misreading: Misreading): string {
  const { side, operation, misfit } = misreading;
  const whole = side === "request" ? `request for ${operation}` : `answer to ${operation}`;
  const noun = typeof misfit.path[0] === "number" ? "item" : "field";
  const part = `${noun} ${misfit.path.map(pathPart).join("")}`;
  switch (misfit.found) {
    case "unknown":
      return `The ${part} in the ${whole} is not one it takes. It takes ${takenWords(misfit.taken)}.`;
    case "missing":
      return `The ${part} is missing from the ${whole}. It must be ${misfit.expected}.`;
    case "unlike":
      return misfit.path.length === 0
        ? `The ${whole} is not ${misfit.expected}.`
        : `The ${part} in the ${whole} is not ${misfit.expected}.`;
  }
}

export type ScriptStart = {
  readonly settings: { readonly [key: string]: Json };
  readonly now: string;
  readonly caller?: string;
  readonly skillInput?: Json;
};

export type Asking = {
  readonly ask: (operation: OperationName, request: Json) => Promise<Answer<Json>>;
  readonly reportUnreadAnswer: (operation: OperationName, value: Json) => void;
};

export function contextOver(asking: Asking, start: ScriptStart): ScriptContext {
  const asked = async <Name extends OperationName>(
    operation: Name,
    request: Requests[Name] & Json,
  ): Promise<Answer<Results[Name]>> => {
    const answer = await asking.ask(operation, request);
    if (!answer.ok) {
      return answer;
    }
    const reading = shapes[operation].result(answer.value);
    if (reading.ok) {
      return { ok: true, value: reading.value };
    }
    asking.reportUnreadAnswer(operation, answer.value);
    return { ok: false, kind: "failed", message: shownToAuthor({ side: "result", operation, misfit: reading.misfit }) };
  };
  const partitionOf = (partition: string): DatabasePartition => ({
    migrate: () => asked("db.migrate", { partition }),
    execute: (sql, parameters = []) => asked("db.execute", { sql, parameters, partition }),
    query: (sql, parameters = []) => asked("db.query", { sql, parameters, partition }),
    agentQuery: (sql) => asked("db.agentQuery", { sql, partition }),
  });
  return {
    db: {
      execute: (sql, parameters = []) => asked("db.execute", { sql, parameters }),
      query: (sql, parameters = []) => asked("db.query", { sql, parameters }),
      partition: partitionOf,
    },
    files: {
      read: (path) => asked("files.read", { path }),
      write: (path, text) => asked("files.write", { path, text }),
      list: (path) => asked("files.list", { path }),
      makeFolder: (path) => asked("files.makeFolder", { path }),
      link: (path, target) => asked("files.link", { path, target }),
      remove: (path) => asked("files.remove", { path }),
    },
    secrets: { get: (name) => asked("secrets.get", { name }) },
    http: { request: (request) => asked("http.request", request) },
    events: { emit: (kind, detail) => asked("events.emit", { kind, detail }) },
    commands: { run: (request) => asked("commands.run", request) },
    call: (reference, input) => asked("call", { reference, input }),
    settings: start.settings,
    now: () => new Date(start.now),
    spend: (spending) => asked("spend", { spending: { ...spending } }),
    caller: start.caller,
    skillInput: start.skillInput,
  };
}
