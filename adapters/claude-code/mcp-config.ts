import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isRecord } from "./guard-input.ts";
import { parseObject, withMember, withoutMember, jsonText, type JsonObject } from "./json-file.ts";
import type { Merged, Unmerged } from "./settings.ts";

const serverName = "agentbay";

export type McpAddition = {
  readonly kind: "mcp";
  readonly server: JsonObject;
  readonly previous: unknown;
  readonly createdServers: boolean;
};

export function kernelServer(kit: string, root: string): JsonObject {
  return { command: "node", args: [join(kit, "bay", "mcp.ts"), "--project", root] };
}

export function mergeMcp(text: string | undefined, server: JsonObject): Merged<McpAddition> {
  const parsed = parseObject(text);
  if (!parsed.ok) {
    return { ok: false, message: "is not a JSON object" };
  }
  const servers = parsed.value["mcpServers"] ?? {};
  if (!isRecord(servers)) {
    return { ok: false, message: "has an mcpServers entry that is not an object" };
  }
  const merged = withMember(parsed.value, "mcpServers", withMember(servers, serverName, server));
  const addition: McpAddition = {
    kind: "mcp",
    server,
    previous: servers[serverName] ?? null,
    createdServers: !("mcpServers" in parsed.value),
  };
  return { ok: true, text: jsonText(merged), addition };
}

export function unmergeMcp(text: string, addition: McpAddition): Unmerged {
  const parsed = parseObject(text);
  const servers = parsed.ok ? parsed.value["mcpServers"] : undefined;
  if (!parsed.ok || !isRecord(servers) || !isDeepStrictEqual(servers[serverName], addition.server)) {
    return { kind: "not-found" };
  }
  const restored =
    addition.previous === null
      ? withoutMember(servers, serverName)
      : withMember(servers, serverName, addition.previous);
  const dropServers = addition.createdServers && Object.keys(restored).length === 0;
  return {
    kind: "removed",
    value: dropServers ? withoutMember(parsed.value, "mcpServers") : withMember(parsed.value, "mcpServers", restored),
  };
}
