export const alwaysDeniedNames: readonly string[] = [
  ".agentbay",
  ".claude",
  ".git",
  ".mcp.json",
  "CLAUDE.md",
  "agentbay.config.yaml",
  ".env",
  ".env.*",
];

export const kitFolders: readonly string[] = ["bay", "schemas", "adapters", "framework"];

export const searchBound = { entries: 5000, depth: 12 } as const;

export type StepRules = {
  readonly mode: string;
  readonly skill: string;
  readonly tools: readonly string[];
  readonly read: readonly string[];
  readonly write: readonly string[];
  readonly commands: readonly string[];
};

export type StepsFile = {
  readonly version: 1;
  readonly project: string;
  readonly kit: string;
  readonly agents: Readonly<Record<string, StepRules>>;
};

export type StepsPolicy = {
  readonly agents: ReadonlyMap<string, StepRules>;
};

export type PolicyReading =
  { readonly kind: "read"; readonly policy: StepsPolicy } | { readonly kind: "unusable"; readonly reason: string };

export type ToolCall = {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly agentId: string | undefined;
  readonly agentType: string | undefined;
  readonly cwd: string | undefined;
};

export type PayloadReading =
  { readonly kind: "call"; readonly call: ToolCall } | { readonly kind: "malformed"; readonly reason: string };

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function stepRulesOf(value: unknown): StepRules | undefined {
  if (!isRecord(value) || typeof value["mode"] !== "string" || typeof value["skill"] !== "string") {
    return undefined;
  }
  const { tools, read, write, commands } = value;
  if (!isStringList(tools) || !isStringList(read) || !isStringList(write) || !isStringList(commands)) {
    return undefined;
  }
  return { mode: value["mode"], skill: value["skill"], tools, read, write, commands };
}

function agentsOf(value: unknown): ReadonlyMap<string, StepRules> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const agents = new Map<string, StepRules>();
  for (const [name, entry] of Object.entries(value)) {
    const rules = stepRulesOf(entry);
    if (rules === undefined) {
      return undefined;
    }
    agents.set(name, rules);
  }
  return agents;
}

function parsedJson(text: string): { readonly value: unknown } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return { value };
  } catch {
    return undefined;
  }
}

function unusable(reason: string): PolicyReading {
  return { kind: "unusable", reason };
}

export function readPolicy(text: string | undefined, project: string): PolicyReading {
  if (text === undefined) {
    return unusable("the step policy .agentbay/steps.json is missing; run the agentbay build");
  }
  const parsed = parsedJson(text);
  if (parsed === undefined || !isRecord(parsed.value)) {
    return unusable("the step policy .agentbay/steps.json is not a JSON object");
  }
  if (parsed.value["version"] !== 1 || parsed.value["project"] !== project) {
    return unusable(`the step policy .agentbay/steps.json is not version 1 for the project ${project}`);
  }
  const agents = agentsOf(parsed.value["agents"]);
  if (agents === undefined) {
    return unusable("the step policy .agentbay/steps.json has a malformed agents entry");
  }
  return { kind: "read", policy: { agents } };
}

function optionalText(value: unknown): { readonly ok: boolean; readonly text: string | undefined } {
  if (value === undefined) {
    return { ok: true, text: undefined };
  }
  return typeof value === "string" && value !== "" ? { ok: true, text: value } : { ok: false, text: undefined };
}

export function readPayload(payload: unknown): PayloadReading {
  if (!isRecord(payload)) {
    return { kind: "malformed", reason: "the hook payload is not a JSON object" };
  }
  const { tool_name: tool, tool_input: input, cwd } = payload;
  if (typeof tool !== "string" || tool === "" || !isRecord(input)) {
    return { kind: "malformed", reason: "the hook payload has no tool_name text or no tool_input object" };
  }
  const agentId = optionalText(payload["agent_id"]);
  const agentType = optionalText(payload["agent_type"]);
  if (!agentId.ok || !agentType.ok || (cwd !== undefined && typeof cwd !== "string")) {
    return { kind: "malformed", reason: "the hook payload has an agent_id, agent_type or cwd that is not text" };
  }
  return { kind: "call", call: { tool, input, agentId: agentId.text, agentType: agentType.text, cwd } };
}
