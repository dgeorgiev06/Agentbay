import type { Resource } from "../answers.ts";
import type { Json } from "../contracts.ts";
import { isJson, isJsonRecord } from "../protocol-json.ts";
import { httpMethods, isHttpMethod, isParameters, isStringRecord, isText, isTexts } from "./script-protocol.ts";
import type {
  AgentQueryResult,
  CommandRan,
  CommandRequest,
  ExecuteResult,
  HttpRequest,
  HttpResponse,
  Row,
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
  readonly "db.agentQuery": { readonly sql: string; readonly partition: string };
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

export type Reading<Value> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly problem: string };

export type Shape<Name extends OperationName> = {
  readonly resource: Resource;
  readonly request: (value: Json) => Reading<Requests[Name]>;
  readonly result: (value: Json) => Reading<Results[Name]>;
};

function read<Value>(value: Value): Reading<Value> {
  return { ok: true, value };
}

function unlike(what: string): Reading<never> {
  return { ok: false, problem: `The value is not ${what}.` };
}

function lacking(field: string, what: string): Reading<never> {
  return { ok: false, problem: `The field ${field} is missing or is not ${what}.` };
}

function misgiven(field: string, what: string): Reading<never> {
  return { ok: false, problem: `The field ${field} is given but is not ${what}.` };
}

const notAMapping = unlike("a mapping");

function statementRequestOf(value: Json): Reading<StatementRequest> {
  if (!isJsonRecord(value)) {
    return notAMapping;
  }
  const { sql, parameters, partition } = value;
  if (!isText(sql)) {
    return lacking("sql", "text");
  }
  if (!isParameters(parameters)) {
    return lacking("parameters", "a list or a mapping");
  }
  if (partition === undefined) {
    return read({ sql, parameters });
  }
  return isText(partition) ? read({ sql, parameters, partition }) : misgiven("partition", "text");
}

function migrateRequestOf(value: Json): Reading<Requests["db.migrate"]> {
  if (!isJsonRecord(value)) {
    return notAMapping;
  }
  return isText(value.partition) ? read({ partition: value.partition }) : lacking("partition", "text");
}

function agentQueryRequestOf(value: Json): Reading<Requests["db.agentQuery"]> {
  if (!isJsonRecord(value)) {
    return notAMapping;
  }
  const { sql, partition } = value;
  if (!isText(sql)) {
    return lacking("sql", "text");
  }
  return isText(partition) ? read({ sql, partition }) : lacking("partition", "text");
}

function pathRequestOf(value: Json): Reading<PathRequest> {
  if (!isJsonRecord(value)) {
    return notAMapping;
  }
  return isText(value.path) ? read({ path: value.path }) : lacking("path", "text");
}

function writeRequestOf(value: Json): Reading<Requests["files.write"]> {
  if (!isJsonRecord(value)) {
    return notAMapping;
  }
  const { path, text } = value;
  if (!isText(path)) {
    return lacking("path", "text");
  }
  return isText(text) ? read({ path, text }) : lacking("text", "text");
}

function linkRequestOf(value: Json): Reading<Requests["files.link"]> {
  if (!isJsonRecord(value)) {
    return notAMapping;
  }
  const { path, target } = value;
  if (!isText(path)) {
    return lacking("path", "text");
  }
  return isText(target) ? read({ path, target }) : lacking("target", "text");
}

function secretRequestOf(value: Json): Reading<Requests["secrets.get"]> {
  if (!isJsonRecord(value)) {
    return notAMapping;
  }
  return isText(value.name) ? read({ name: value.name }) : lacking("name", "text");
}

function httpRequestOf(value: Json): Reading<HttpRequest> {
  if (!isJsonRecord(value)) {
    return notAMapping;
  }
  const { method, url, headers, body } = value;
  if (!isHttpMethod(method)) {
    return lacking("method", `one of ${httpMethods.join(", ")}`);
  }
  if (!isText(url)) {
    return lacking("url", "text");
  }
  if (!isStringRecord(headers)) {
    return lacking("headers", "a mapping of text to text");
  }
  if (body === undefined) {
    return read({ method, url, headers });
  }
  return isText(body) ? read({ method, url, headers, body }) : misgiven("body", "text");
}

function emitRequestOf(value: Json): Reading<Requests["events.emit"]> {
  if (!isJsonRecord(value)) {
    return notAMapping;
  }
  const { kind, detail } = value;
  if (!isText(kind)) {
    return lacking("kind", "text");
  }
  return detail === undefined ? lacking("detail", "a JSON value") : read({ kind, detail });
}

function callRequestOf(value: Json): Reading<Requests["call"]> {
  if (!isJsonRecord(value)) {
    return notAMapping;
  }
  const { reference, input } = value;
  if (!isText(reference)) {
    return lacking("reference", "text");
  }
  return input === undefined ? lacking("input", "a JSON value") : read({ reference, input });
}

function spendRequestOf(value: Json): Reading<Requests["spend"]> {
  if (!isJsonRecord(value)) {
    return notAMapping;
  }
  const spending = value.spending;
  return spending === undefined ? lacking("spending", "a JSON value") : read({ spending });
}

function commandRequestOf(value: Json): Reading<CommandRequest> {
  if (!isJsonRecord(value)) {
    return notAMapping;
  }
  const { command, folder, timeLimitSeconds, input } = value;
  if (!isTexts(command)) {
    return lacking("command", "a list of text");
  }
  if (!isText(folder)) {
    return lacking("folder", "text");
  }
  if (typeof timeLimitSeconds !== "number") {
    return lacking("timeLimitSeconds", "a number");
  }
  if (input === undefined) {
    return read({ command, folder, timeLimitSeconds });
  }
  return isText(input) ? read({ command, folder, timeLimitSeconds, input }) : misgiven("input", "text");
}

function isExecuteResult(value: Json): value is ExecuteResult {
  return isJsonRecord(value) && typeof value.changes === "number" && typeof value.lastInsertRowid === "number";
}

function isRows(value: Json): value is readonly Row[] {
  return Array.isArray(value) && value.every((row: Json) => isJsonRecord(row));
}

function isAgentQueryResult(value: Json): value is AgentQueryResult {
  return (
    isJsonRecord(value) &&
    isTexts(value.columns) &&
    Array.isArray(value.rows) &&
    value.rows.every((row: Json) => Array.isArray(row))
  );
}

function isResponse(value: Json): value is HttpResponse {
  return (
    isJsonRecord(value) &&
    typeof value.status === "number" &&
    isStringRecord(value.headers) &&
    typeof value.body === "string"
  );
}

function isCommandEnd(value: Json | undefined): boolean {
  if (!isJsonRecord(value)) {
    return false;
  }
  if (value.how === "exited") {
    return typeof value.exitCode === "number";
  }
  return value.how === "signalled" ? isText(value.signal) : value.how === "timed-out";
}

function isCommandOutput(value: Json | undefined): boolean {
  return isJsonRecord(value) && isText(value.text) && typeof value.cut === "boolean";
}

function isCommandRan(value: Json): value is CommandRan {
  return (
    isJsonRecord(value) &&
    isCommandEnd(value.end) &&
    typeof value.milliseconds === "number" &&
    isCommandOutput(value.stdout) &&
    isCommandOutput(value.stderr)
  );
}

function executeResultOf(value: Json): Reading<ExecuteResult> {
  return isExecuteResult(value) ? read(value) : unlike("a count of changes with the last row id");
}

function rowsOf(value: Json): Reading<readonly Row[]> {
  return isRows(value) ? read(value) : unlike("a list of rows");
}

function textsOf(value: Json): Reading<readonly string[]> {
  return isTexts(value) ? read(value) : unlike("a list of text");
}

function agentQueryResultOf(value: Json): Reading<AgentQueryResult> {
  return isAgentQueryResult(value) ? read(value) : unlike("columns with rows");
}

function textOf(value: Json): Reading<string> {
  return isText(value) ? read(value) : unlike("text");
}

function nothingOf(value: Json): Reading<null> {
  return value === null ? read(value) : unlike("null");
}

function responseOf(value: Json): Reading<HttpResponse> {
  return isResponse(value) ? read(value) : unlike("a response with a status, headers and a body");
}

function anyJsonOf(value: Json): Reading<Json> {
  return isJson(value) ? read(value) : unlike("a JSON value");
}

function commandRanOf(value: Json): Reading<CommandRan> {
  return isCommandRan(value) ? read(value) : unlike("a command's end, time and output");
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
