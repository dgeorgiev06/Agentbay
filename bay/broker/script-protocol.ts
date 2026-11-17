import type { Answer, Resource } from "../answers.ts";
import type { Json } from "../contracts.ts";
import { isJsonRecord, parsedLine } from "../protocol-json.ts";
import {
  isOperationName,
  isText,
  type OperationName,
  type Reading,
  type Requests,
  type ScriptStart,
  shapes,
} from "./operations.ts";

export const removalAllowedArgument = "--agentbay-may-remove-files";

export type AskedFor<Name extends OperationName> = { readonly operation: Name; readonly request: Requests[Name] };

type Final =
  | { readonly type: "done"; readonly output: Json }
  | { readonly type: "failed"; readonly reason: string }
  | { readonly type: "crashed"; readonly reason: string };

export type ChildLine =
  | { readonly type: "request"; readonly id: number; readonly operation: OperationName; readonly request: Json }
  | { readonly type: "unread-answer"; readonly operation: OperationName; readonly value: Json }
  | Final;

export type ChildMessage =
  | { readonly type: "request"; readonly id: number; readonly asked: AskedFor<OperationName> }
  | { readonly type: "unreadable-request"; readonly operation: OperationName; readonly problem: string }
  | { readonly type: "unread-answer"; readonly operation: OperationName; readonly problem: string }
  | Final;

export type StartMessage = { readonly type: "start"; readonly input: Json } & ScriptStart;

export type ParentMessage =
  StartMessage | { readonly type: "answer"; readonly id: number; readonly answer: Answer<Json> };

type Fields = { readonly [key: string]: Json };

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

function askedOf<Name extends OperationName>(operation: Name, value: Json): Reading<AskedFor<Name>> {
  const reading = shapes[operation].request(value);
  return reading.ok ? { ok: true, value: { operation, request: reading.value } } : reading;
}

function requestMessageOf(id: number, operation: OperationName, value: Json): ChildMessage {
  const reading = askedOf(operation, value);
  if (reading.ok) {
    return { type: "request", id, asked: reading.value };
  }
  return { type: "unreadable-request", operation, problem: reading.problem };
}

function unreadAnswerOf(operation: OperationName, value: Json): ChildMessage | undefined {
  const reading = shapes[operation].result(value);
  return reading.ok ? undefined : { type: "unread-answer", operation, problem: reading.problem };
}

function finalMessageOf(fields: Fields): Final | undefined {
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
  const { type, id, operation } = value;
  if (type === "request" && typeof id === "number" && isOperationName(operation)) {
    return requestMessageOf(id, operation, value.request ?? null);
  }
  if (type === "unread-answer" && isOperationName(operation) && value.value !== undefined) {
    return unreadAnswerOf(operation, value.value);
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
