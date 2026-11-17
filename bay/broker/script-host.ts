import { pathToFileURL } from "node:url";
import type { Answer } from "../answers.ts";
import type { Json } from "../contracts.ts";
import { isJson, isJsonRecord } from "../protocol-json.ts";
import { type ChildMessage, type ParentMessage, parentMessageOf, type ResourceRequest } from "./script-protocol.ts";
import type {
  AgentQueryResult,
  CommandRan,
  DatabasePartition,
  DefinedScript,
  ExecuteResult,
  HttpResponse,
  Row,
  ScriptContext,
  ScriptError,
} from "../sdk.ts";

type Start = Extract<ParentMessage, { readonly type: "start" }>;

const protocolWrite = process.stdout.write.bind(process.stdout);

process.stdout.write = process.stderr.write.bind(process.stderr);

const waiting = new Map<number, (answer: Answer<Json>) => void>();

let nextRequestId = 1;

let started: ((start: Start) => void) | undefined;

const start = new Promise<Start>((resolve) => {
  started = resolve;
});

function send(message: ChildMessage): void {
  protocolWrite(`${JSON.stringify(message)}\n`);
}

function finish(message: ChildMessage): void {
  process.stderr.write("", () => {
    protocolWrite(`${JSON.stringify(message)}\n`, () => {
      process.exit(0);
    });
  });
}

function received(line: string): void {
  const message = parentMessageOf(line);
  if (message?.type === "start") {
    started?.(message);
  } else if (message?.type === "answer") {
    waiting.get(message.id)?.(message.answer);
    waiting.delete(message.id);
  }
}

let pendingInput = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  const lines = (pendingInput + chunk).split("\n");
  pendingInput = lines.pop() ?? "";
  for (const line of lines) {
    received(line);
  }
});

function ask(request: ResourceRequest): Promise<Answer<Json>> {
  const id = nextRequestId;
  nextRequestId += 1;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    send({ type: "request", id, request });
  });
}

function narrowed<T>(answer: Answer<Json>, fits: (value: Json) => value is Json & T): Answer<T> {
  if (!answer.ok) {
    return answer;
  }
  if (fits(answer.value)) {
    return { ok: true, value: answer.value };
  }
  return { ok: false, kind: "failed", message: "The broker's answer did not have the expected shape." };
}

const isText = (value: Json): value is string => typeof value === "string";

const isNothing = (value: Json): value is null => value === null;

const isTexts = (value: Json): value is readonly string[] =>
  Array.isArray(value) && value.every((item: Json) => typeof item === "string");

const isRows = (value: Json): value is readonly Row[] =>
  Array.isArray(value) && value.every((item: Json) => isJsonRecord(item));

const isExecuteResult = (value: Json): value is ExecuteResult =>
  isJsonRecord(value) && typeof value.changes === "number" && typeof value.lastInsertRowid === "number";

const isResponse = (value: Json): value is HttpResponse =>
  isJsonRecord(value) && typeof value.status === "number" && typeof value.body === "string";

const isAnything = (value: Json): value is Json => isJson(value);

const isCells = (value: Json): value is readonly Json[] => Array.isArray(value);

const isCommandOutput = (value: Json | undefined): boolean =>
  isJsonRecord(value) && typeof value.text === "string" && typeof value.cut === "boolean";

const isCommandRan = (value: Json): value is CommandRan & Json =>
  isJsonRecord(value) &&
  isJsonRecord(value.end) &&
  typeof value.end.how === "string" &&
  typeof value.milliseconds === "number" &&
  isCommandOutput(value.stdout) &&
  isCommandOutput(value.stderr);

const isAgentQueryResult = (value: Json): value is AgentQueryResult & Json =>
  isJsonRecord(value) && isTexts(value.columns ?? null) && Array.isArray(value.rows) && value.rows.every(isCells);

function partitionOf(partition: string): DatabasePartition {
  return {
    migrate: async () => narrowed(await ask({ resource: "db.migrate", partition }), isTexts),
    execute: async (sql, parameters = []) =>
      narrowed(await ask({ resource: "db.execute", sql, parameters, partition }), isExecuteResult),
    query: async (sql, parameters = []) =>
      narrowed(await ask({ resource: "db.query", sql, parameters, partition }), isRows),
    agentQuery: async (sql) => narrowed(await ask({ resource: "db.agentQuery", sql, partition }), isAgentQueryResult),
  };
}

function contextFor(order: Start): ScriptContext {
  const settings = order.settings;
  return {
    db: {
      execute: async (sql, parameters = []) =>
        narrowed(await ask({ resource: "db.execute", sql, parameters }), isExecuteResult),
      query: async (sql, parameters = []) => narrowed(await ask({ resource: "db.query", sql, parameters }), isRows),
      partition: partitionOf,
    },
    files: {
      read: async (path) => narrowed(await ask({ resource: "files.read", path }), isText),
      write: async (path, text) => narrowed(await ask({ resource: "files.write", path, text }), isNothing),
      list: async (path) => narrowed(await ask({ resource: "files.list", path }), isTexts),
      makeFolder: async (path) => narrowed(await ask({ resource: "files.makeFolder", path }), isNothing),
      link: async (path, target) => narrowed(await ask({ resource: "files.link", path, target }), isNothing),
      remove: async (path) => narrowed(await ask({ resource: "files.remove", path }), isNothing),
    },
    secrets: { get: async (name) => narrowed(await ask({ resource: "secrets.get", name }), isText) },
    http: { request: async (request) => narrowed(await ask({ resource: "http.request", request }), isResponse) },
    events: {
      emit: async (kind, detail) => narrowed(await ask({ resource: "events.emit", kind, detail }), isNothing),
    },
    commands: {
      run: async (request) => narrowed(await ask({ resource: "commands.run", request }), isCommandRan),
    },
    call: async (reference, input) => narrowed(await ask({ resource: "call", reference, input }), isAnything),
    settings,
    now: () => new Date(order.now),
    spend: async (spending) => narrowed(await ask({ resource: "spend", spending: { ...spending } }), isNothing),
    caller: order.caller,
    skillInput: order.skillInput,
  };
}

function isDefinedScript(value: unknown): value is DefinedScript {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "agentbay-script" &&
    "handler" in value &&
    typeof value.handler === "function"
  );
}

function scriptErrorOf(error: unknown): ScriptError | undefined {
  if (!(error instanceof Error) || typeof error.cause !== "object" || error.cause === null) {
    return undefined;
  }
  const cause = error.cause;
  if ("kind" in cause && cause.kind === "script-error" && "reason" in cause && typeof cause.reason === "string") {
    return { kind: "script-error", reason: cause.reason };
  }
  return undefined;
}

function described(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function loadScript(file: string): Promise<DefinedScript | string> {
  try {
    const loaded: unknown = await import(pathToFileURL(file).href);
    const run: unknown = typeof loaded === "object" && loaded !== null && "run" in loaded ? loaded.run : undefined;
    return isDefinedScript(run) ? run : "The script's run export was not made with defineScript from bay/sdk.ts.";
  } catch (error) {
    return `The script could not be loaded: ${described(error)}`;
  }
}

async function runScript(file: string): Promise<ChildMessage> {
  const order = await start;
  const script = await loadScript(file);
  if (typeof script === "string") {
    return { type: "crashed", reason: script };
  }
  try {
    const output: unknown = await script.handler(order.input, contextFor(order));
    return isJson(output)
      ? { type: "done", output }
      : { type: "crashed", reason: "The script returned no JSON value." };
  } catch (error) {
    const scriptError = scriptErrorOf(error);
    return scriptError === undefined
      ? { type: "crashed", reason: described(error) }
      : { type: "failed", reason: scriptError.reason };
  }
}

finish(await runScript(process.argv[2] ?? ""));
