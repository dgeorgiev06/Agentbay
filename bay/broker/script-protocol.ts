import type { Answer, Resource } from "../answers.ts";
import type { Json } from "../contracts.ts";
import { isJsonRecord, parsedLine } from "../protocol-json.ts";
import type { CommandRequest, HttpRequest, SqlParameters } from "../sdk.ts";

export const sdkSpecifier = "agentbay/sdk";

export const removalAllowedArgument = "--agentbay-may-remove-files";

export type ResourceRequest =
  | {
      readonly resource: "db.execute" | "db.query";
      readonly sql: string;
      readonly parameters: SqlParameters;
      readonly partition?: string;
    }
  | { readonly resource: "db.migrate"; readonly partition: string }
  | { readonly resource: "db.agentQuery"; readonly sql: string; readonly partition: string }
  | { readonly resource: "files.read" | "files.list"; readonly path: string }
  | { readonly resource: "files.write"; readonly path: string; readonly text: string }
  | { readonly resource: "files.makeFolder" | "files.remove"; readonly path: string }
  | { readonly resource: "files.link"; readonly path: string; readonly target: string }
  | { readonly resource: "secrets.get"; readonly name: string }
  | { readonly resource: "http.request"; readonly request: HttpRequest }
  | { readonly resource: "events.emit"; readonly kind: string; readonly detail: Json }
  | { readonly resource: "call"; readonly reference: string; readonly input: Json }
  | { readonly resource: "spend"; readonly spending: Json }
  | { readonly resource: "commands.run"; readonly request: CommandRequest };

export type ChildMessage =
  | { readonly type: "request"; readonly id: number; readonly request: ResourceRequest }
  | { readonly type: "done"; readonly output: Json }
  | { readonly type: "failed"; readonly reason: string }
  | { readonly type: "crashed"; readonly reason: string };

export type StartMessage = {
  readonly type: "start";
  readonly input: Json;
  readonly settings: { readonly [key: string]: Json };
  readonly now: string;
  readonly caller?: string;
  readonly skillInput?: Json;
};

export type ParentMessage =
  StartMessage | { readonly type: "answer"; readonly id: number; readonly answer: Answer<Json> };

type Fields = { readonly [key: string]: Json };

export const httpMethods: readonly string[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const resources: readonly string[] = [
  "db",
  "files",
  "secrets",
  "http",
  "events",
  "call",
  "spend",
  "script",
  "commands",
];

function isResource(value: Json | undefined): value is Resource {
  return typeof value === "string" && resources.includes(value);
}

export function isText(value: Json | undefined): value is string {
  return typeof value === "string";
}

export function isStringRecord(value: Json | undefined): value is { readonly [key: string]: string } {
  return isJsonRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

export function isParameters(value: Json | undefined): value is SqlParameters {
  return Array.isArray(value) || isJsonRecord(value);
}

export function isHttpMethod(value: Json | undefined): value is HttpRequest["method"] {
  return typeof value === "string" && httpMethods.includes(value);
}

function httpRequestOf(value: Json | undefined): HttpRequest | undefined {
  if (!isJsonRecord(value) || !isHttpMethod(value.method) || !isText(value.url) || !isStringRecord(value.headers)) {
    return undefined;
  }
  if (value.body === undefined) {
    return { method: value.method, url: value.url, headers: value.headers };
  }
  return isText(value.body)
    ? { method: value.method, url: value.url, headers: value.headers, body: value.body }
    : undefined;
}

export function isTexts(value: Json | undefined): value is readonly string[] {
  return Array.isArray(value) && value.every((item: Json) => typeof item === "string");
}

function commandRequestOf(value: Json | undefined): CommandRequest | undefined {
  if (!isJsonRecord(value) || !isTexts(value.command) || !isText(value.folder)) {
    return undefined;
  }
  const { timeLimitSeconds, input } = value;
  if (typeof timeLimitSeconds !== "number" || (input !== undefined && !isText(input))) {
    return undefined;
  }
  const request = { command: value.command, folder: value.folder, timeLimitSeconds };
  return input === undefined ? request : { ...request, input };
}

function partitionRequestOf(fields: Fields): ResourceRequest | undefined {
  const { resource, partition, sql } = fields;
  if (!isText(partition)) {
    return undefined;
  }
  if (resource === "db.migrate") {
    return { resource, partition };
  }
  return resource === "db.agentQuery" && isText(sql) ? { resource, sql, partition } : undefined;
}

function databaseRequestOf(fields: Fields): ResourceRequest | undefined {
  const { resource, sql, parameters, partition } = fields;
  const isStatement = resource === "db.execute" || resource === "db.query";
  if (!isStatement || !isText(sql) || !isParameters(parameters)) {
    return partitionRequestOf(fields);
  }
  if (partition === undefined) {
    return { resource, sql, parameters };
  }
  return isText(partition) ? { resource, sql, parameters, partition } : undefined;
}

function fileRequestOf(fields: Fields): ResourceRequest | undefined {
  const resource = fields.resource;
  if (!isText(fields.path)) {
    return undefined;
  }
  if (resource === "files.read" || resource === "files.list") {
    return { resource, path: fields.path };
  }
  if (resource === "files.makeFolder" || resource === "files.remove") {
    return { resource, path: fields.path };
  }
  if (resource === "files.write" && isText(fields.text)) {
    return { resource, path: fields.path, text: fields.text };
  }
  if (resource === "files.link" && isText(fields.target)) {
    return { resource, path: fields.path, target: fields.target };
  }
  return undefined;
}

function secretOrEventRequestOf(fields: Fields): ResourceRequest | undefined {
  if (fields.resource === "secrets.get" && isText(fields.name)) {
    return { resource: "secrets.get", name: fields.name };
  }
  if (fields.resource === "events.emit" && isText(fields.kind) && fields.detail !== undefined) {
    return { resource: "events.emit", kind: fields.kind, detail: fields.detail };
  }
  return undefined;
}

function callOrSpendRequestOf(fields: Fields): ResourceRequest | undefined {
  if (fields.resource === "call" && isText(fields.reference) && fields.input !== undefined) {
    return { resource: "call", reference: fields.reference, input: fields.input };
  }
  if (fields.resource === "spend" && fields.spending !== undefined) {
    return { resource: "spend", spending: fields.spending };
  }
  return undefined;
}

function resourceRequestOf(value: Json | undefined): ResourceRequest | undefined {
  if (!isJsonRecord(value)) {
    return undefined;
  }
  if (value.resource === "http.request") {
    const request = httpRequestOf(value.request);
    return request === undefined ? undefined : { resource: "http.request", request };
  }
  if (value.resource === "commands.run") {
    const request = commandRequestOf(value.request);
    return request === undefined ? undefined : { resource: "commands.run", request };
  }
  return (
    databaseRequestOf(value) ?? fileRequestOf(value) ?? secretOrEventRequestOf(value) ?? callOrSpendRequestOf(value)
  );
}

function finalMessageOf(fields: Fields): ChildMessage | undefined {
  if (fields.type === "done") {
    return fields.output === undefined ? undefined : { type: "done", output: fields.output };
  }
  if ((fields.type === "failed" || fields.type === "crashed") && isText(fields.reason)) {
    return { type: fields.type, reason: fields.reason };
  }
  return undefined;
}

export function childMessageOf(line: string): ChildMessage | undefined {
  const value = parsedLine(line);
  if (!isJsonRecord(value)) {
    return undefined;
  }
  if (value.type === "request" && typeof value.id === "number") {
    const request = resourceRequestOf(value.request);
    return request === undefined ? undefined : { type: "request", id: value.id, request };
  }
  return finalMessageOf(value);
}

function refusalOf(fields: Fields): Answer<Json> | undefined {
  const { resource, asked, declared, change, message } = fields;
  if (isResource(resource) && isText(asked) && isText(declared) && isText(change) && isText(message)) {
    return { ok: false, kind: "refused", resource, asked, declared, change, message };
  }
  return undefined;
}

function answerOf(value: Json | undefined): Answer<Json> | undefined {
  if (!isJsonRecord(value)) {
    return undefined;
  }
  if (value.ok === true && value.value !== undefined) {
    return { ok: true, value: value.value };
  }
  if (value.ok === false && value.kind === "failed" && isText(value.message)) {
    return { ok: false, kind: "failed", message: value.message };
  }
  return value.ok === false && value.kind === "refused" ? refusalOf(value) : undefined;
}

type StartFields = Omit<StartMessage, "type" | "caller" | "skillInput">;

function startMessageOf(fields: Fields, given: StartFields): ParentMessage {
  const caller = isText(fields.caller) ? { caller: fields.caller } : {};
  const skillInput = fields.skillInput === undefined ? {} : { skillInput: fields.skillInput };
  return { type: "start", ...given, ...caller, ...skillInput };
}

export function parentMessageOf(line: string): ParentMessage | undefined {
  const value = parsedLine(line);
  if (!isJsonRecord(value)) {
    return undefined;
  }
  const { input, settings, now } = value;
  if (value.type === "start" && input !== undefined && isJsonRecord(settings) && isText(now)) {
    return startMessageOf(value, { input, settings, now });
  }
  const answer = value.type === "answer" ? answerOf(value.answer) : undefined;
  if (answer !== undefined && typeof value.id === "number") {
    return { type: "answer", id: value.id, answer };
  }
  return undefined;
}
