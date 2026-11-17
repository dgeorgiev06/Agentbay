import { pathToFileURL } from "node:url";
import type { Answer } from "../answers.ts";
import type { Json } from "../contracts.ts";
import { isJson, isJsonRecord } from "../protocol-json.ts";
import { contextOver, type OperationName } from "./operations.ts";
import { type ChildMessage, type ParentMessage, parentMessageOf } from "./script-protocol.ts";
import type { DefinedScript, ScriptError } from "../sdk.ts";

type Start = Extract<ParentMessage, { readonly type: "start" }>;

const protocolWrite = process.stdout.write.bind(process.stdout);

process.stdout.write = process.stderr.write.bind(process.stderr);

const waiting = new Map<number, (answer: Answer<Json>) => void>();

let nextRequestId = 1;

let started: ((start: Start) => void) | undefined;

const start = new Promise<Start>((resolve) => {
  started = resolve;
});

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

function ask(operation: OperationName, request: Json): Promise<Answer<Json>> {
  const id = nextRequestId;
  nextRequestId += 1;
  const fields = operation === "http.request" || operation === "commands.run" ? { request } : request;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    protocolWrite(
      `${JSON.stringify({ type: "request", id, request: { resource: operation, ...fieldsOf(fields) } })}\n`,
    );
  });
}

function fieldsOf(value: Json): { readonly [key: string]: Json } {
  return isJsonRecord(value) ? value : {};
}

function reportUnreadAnswer(): void {
  return undefined;
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
    const output: unknown = await script.handler(order.input, contextOver({ ask, reportUnreadAnswer }, order));
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
