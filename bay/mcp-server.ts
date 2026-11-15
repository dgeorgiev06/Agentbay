import type { Json } from "./contracts.ts";
import { fieldOf, parseJson, textField, isRecord } from "./json.ts";
import type { ToolDefinition } from "./tool-definitions.ts";
import { problemText, type Outcome } from "./outcome.ts";
import { VERSION } from "./version.ts";

export type ToolServer = {
  readonly definitions: readonly ToolDefinition[];
  readonly call: (name: string, input: Json) => Promise<Outcome<Json>>;
};

type Request = {
  readonly id: Json | undefined;
  readonly method: string;
  readonly params: Json;
};

type ProtocolFailure = {
  readonly failure: true;
  readonly code: number;
  readonly message: string;
};

type MethodHandler = (server: ToolServer, request: Request) => Promise<Json | ProtocolFailure>;

export const serverName = "agentbay";

const protocolVersions: readonly string[] = ["2025-06-18", "2025-03-26", "2024-11-05"];

const errorCodes = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

const internalFailure = protocolFailure(
  errorCodes.internal,
  "agentbay stopped at an unexpected error while answering; the call was not carried out. Try again, or tell the owner.",
);

function protocolFailure(code: number, message: string): ProtocolFailure {
  return { failure: true, code, message };
}

function isFailure(value: Json | ProtocolFailure): value is ProtocolFailure {
  return isRecord(value) && value.failure === true && typeof value.code === "number";
}

function initialize(_server: ToolServer, request: Request): Promise<Json> {
  const asked = textField(request.params, "protocolVersion");
  const protocolVersion = asked !== undefined && protocolVersions.includes(asked) ? asked : (protocolVersions[0] ?? "");
  return Promise.resolve({
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: serverName, version: VERSION },
  });
}

function listTools(server: ToolServer): Promise<Json> {
  const tools = server.definitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
  return Promise.resolve({ tools });
}

async function callTool(server: ToolServer, request: Request): Promise<Json | ProtocolFailure> {
  const name = textField(request.params, "name");
  if (name === undefined) {
    return protocolFailure(errorCodes.invalidParams, "tools/call needs params.name.");
  }
  const result = await server.call(name, fieldOf(request.params, "arguments") ?? {});
  if (!result.ok) {
    return { content: [{ type: "text", text: problemText(result.problems) }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(result.value) }], isError: false };
}

const methods: ReadonlyMap<string, MethodHandler> = new Map<string, MethodHandler>([
  ["initialize", initialize],
  ["ping", () => Promise.resolve({})],
  ["tools/list", listTools],
  ["tools/call", callTool],
]);

function requestOf(message: Json): Request | ProtocolFailure {
  if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return protocolFailure(errorCodes.invalidRequest, "A message must be a JSON-RPC 2.0 request.");
  }
  return { id: fieldOf(message, "id"), method: message.method, params: fieldOf(message, "params") ?? {} };
}

function errorReply(id: Json, failure: ProtocolFailure): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code: failure.code, message: failure.message } });
}

function parsedMessage(line: string): { readonly message: Json } | ProtocolFailure {
  try {
    return { message: parseJson(line) };
  } catch {
    return protocolFailure(errorCodes.parse, "The line is not valid JSON.");
  }
}

async function answer(server: ToolServer, request: Request): Promise<string | undefined> {
  const handler = methods.get(request.method);
  if (request.id === undefined) {
    return undefined;
  }
  if (handler === undefined) {
    return errorReply(request.id, protocolFailure(errorCodes.methodNotFound, `There is no method ${request.method}.`));
  }
  const result = await handler(server, request).catch(() => internalFailure);
  return isFailure(result)
    ? errorReply(request.id, result)
    : JSON.stringify({ jsonrpc: "2.0", id: request.id, result });
}

export async function replyTo(server: ToolServer, line: string): Promise<string | undefined> {
  if (line.trim() === "") {
    return undefined;
  }
  const parsed = parsedMessage(line);
  if ("failure" in parsed) {
    return errorReply(null, parsed);
  }
  const message = parsed.message;
  const request = requestOf(message);
  if ("failure" in request) {
    return errorReply(isRecord(message) ? (fieldOf(message, "id") ?? null) : null, request);
  }
  return answer(server, request);
}
