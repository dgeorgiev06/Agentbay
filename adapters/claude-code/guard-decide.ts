import { isAbsolute, join, sep } from "node:path";
import { checkCommand } from "./guard-commands.ts";
import {
  alwaysDeniedNames,
  kitFolders,
  readPayload,
  type PolicyReading,
  type StepRules,
  type ToolCall,
} from "./guard-input.ts";
import {
  insideAnyRoot,
  isInsideIgnoringCase,
  matchesName,
  protectedLocations,
  protectedPart,
  realRoots,
  resolveTarget,
  type PathFacts,
  type Places,
} from "./guard-paths.ts";

export type GuardSetup = {
  readonly root: string;
  readonly kit: string;
  readonly policy: PolicyReading;
};

export type Decision = { readonly verdict: "allow" } | { readonly verdict: "deny"; readonly reason: string };

type Caller =
  | { readonly kind: "owner" }
  | { readonly kind: "step"; readonly name: string; readonly rules: StepRules }
  | { readonly kind: "stranger"; readonly name: string }
  | { readonly kind: "unverifiable"; readonly name: string; readonly reason: string };

type ToolKind = "read" | "write" | "search" | "command" | "kernel" | "other";

type StepContext = {
  readonly call: ToolCall;
  readonly name: string;
  readonly rules: StepRules;
  readonly places: Places;
  readonly facts: PathFacts;
};

const ownRulesMessage = "this changes agentbay's own rules; only the owner edits it, outside the agent";

const ownerClosedNames: readonly string[] = [".agentbay", ".claude", ".mcp.json"];

const allow: Decision = { verdict: "allow" };

function deny(reason: string): Decision {
  return { verdict: "deny", reason: `agentbay denied ${reason}.` };
}

function toolKind(tool: string): ToolKind {
  if (tool === "Read") {
    return "read";
  }
  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
    return "write";
  }
  if (tool === "Glob" || tool === "Grep") {
    return "search";
  }
  if (tool === "Bash") {
    return "command";
  }
  return tool.startsWith("mcp__agentbay__") ? "kernel" : "other";
}

function placesOf(setup: GuardSetup): Places {
  const policy = setup.policy.kind === "read" ? setup.policy.policy : undefined;
  return {
    root: setup.root,
    kit: setup.kit,
    deniedNames: policy?.deniedNames ?? alwaysDeniedNames,
    deniedKitFolders: policy?.deniedKitFolders ?? kitFolders,
  };
}

function identify(setup: GuardSetup, call: ToolCall): Caller {
  const name = call.agentType ?? call.agentId ?? "";
  if (call.agentId === undefined && call.agentType === undefined) {
    return { kind: "owner" };
  }
  if (setup.policy.kind === "unusable") {
    return { kind: "unverifiable", name, reason: setup.policy.reason };
  }
  const rules = call.agentType === undefined ? undefined : setup.policy.policy.agents.get(call.agentType);
  if (rules !== undefined) {
    return { kind: "step", name, rules };
  }
  return call.agentId === undefined ? { kind: "owner" } : { kind: "stranger", name };
}

function targetOf(call: ToolCall): unknown {
  return call.tool === "NotebookEdit" ? call.input["notebook_path"] : call.input["file_path"];
}

function workingFolder(call: ToolCall, places: Places): string {
  return call.cwd ?? places.root;
}

function ownerClosedFolders(places: Places, facts: PathFacts): readonly string[] {
  const roots = [places.root, ...realRoots([places.root], facts)];
  const kits = [places.kit, ...realRoots([places.kit], facts)];
  return [
    ...roots.flatMap((root) => ownerClosedNames.map((name) => join(root, name))),
    ...kits.flatMap((kit) => places.deniedKitFolders.map((folder) => join(kit, folder))),
  ];
}

function ownerDecision(call: ToolCall, places: Places, facts: PathFacts): Decision {
  if (toolKind(call.tool) !== "write") {
    return allow;
  }
  const raw = targetOf(call);
  if (typeof raw !== "string") {
    return deny(`${call.tool}: the call names no file path text, so the hook cannot check it`);
  }
  const target = resolveTarget(raw, workingFolder(call, places), facts);
  if (target.kind === "refused") {
    return deny(`${call.tool} of ${raw}: ${target.why}`);
  }
  const closed = ownerClosedFolders(places, facts);
  const touches = [target.written, target.real].some((path) =>
    closed.some((folder) => isInsideIgnoringCase(path, folder)),
  );
  return touches ? deny(`${call.tool} of ${target.written}: ${ownRulesMessage}`) : allow;
}

function howToAllow(tool: string, rules: StepRules): string {
  switch (toolKind(tool)) {
    case "read":
    case "search":
      return `a folder under resources.files.read in the mode.yaml of mode ${rules.mode} would allow reading it`;
    case "write":
      return `a folder under resources.files.write in the mode.yaml of mode ${rules.mode} would allow writing it`;
    case "command":
      return `a prefix under resources.commands in the mode.yaml of mode ${rules.mode} would allow a command`;
    case "kernel":
      return `naming ${tool.slice("mcp__agentbay__".length)} in the Tools section of skill ${rules.skill} would allow it`;
    case "other":
      return "no manifest line allows it";
  }
}

function listed(items: readonly string[]): string {
  return items.length === 0 ? "nothing" : items.join(", ");
}

function stepDenial(context: StepContext, asked: string, why: string): Decision {
  return deny(`${asked} for step ${context.name}: ${why}; ${howToAllow(context.call.tool, context.rules)}`);
}

function folderDecision(context: StepContext, raw: string, roots: readonly string[]): Decision {
  const { call, places, facts } = context;
  const asked = `${call.tool} of ${raw}`;
  const target = resolveTarget(raw, workingFolder(call, places), facts);
  if (target.kind === "refused") {
    return stepDenial(context, asked, target.why);
  }
  const part = protectedPart([target.written, target.real], places, facts);
  if (part !== undefined) {
    return deny(`${asked} for step ${context.name}: ${part} is closed to every skill step whatever its paths`);
  }
  if (!insideAnyRoot(target.real, realRoots(roots, facts))) {
    return stepDenial(context, asked, `the step may use only ${listed(roots)}, and the real path is ${target.real}`);
  }
  return allow;
}

function fileDecision(context: StepContext, roots: readonly string[]): Decision {
  const raw = targetOf(context.call);
  if (typeof raw !== "string") {
    return deny(`${context.call.tool} for step ${context.name}: the call names no file path text`);
  }
  return folderDecision(context, raw, roots);
}

const wildcard = /[*?[\]{}]/;

function staticFolderOf(pattern: string): string {
  const segments = pattern.split(sep);
  const firstWild = segments.findIndex((segment) => wildcard.test(segment));
  const fixed = firstWild === -1 ? segments.slice(0, -1) : segments.slice(0, firstWild);
  return fixed.join(sep) || sep;
}

function patternProblem(pattern: string, places: Places): string | undefined {
  if (pattern.includes("..") || pattern.startsWith("~")) {
    return "a search pattern may not climb with '..' or start with '~'";
  }
  const segments = pattern.split(/[\\/]/);
  if (segments.some((segment) => places.deniedNames.some((name) => matchesName(segment, name)))) {
    return "the pattern names a location closed to every skill step";
  }
  if (segments.some((segment) => segment.startsWith(".") && wildcard.test(segment))) {
    return "a wildcard over hidden names could reach a location closed to every skill step";
  }
  return undefined;
}

function patternDecision(context: StepContext, pattern: unknown): Decision {
  if (pattern === undefined) {
    return allow;
  }
  const asked = `${context.call.tool} with pattern ${JSON.stringify(pattern)} for step ${context.name}`;
  if (typeof pattern !== "string") {
    return deny(`${asked}: a search pattern must be text`);
  }
  const problem = patternProblem(pattern, context.places);
  if (problem !== undefined) {
    return deny(`${asked}: ${problem}`);
  }
  return isAbsolute(pattern) ? folderDecision(context, staticFolderOf(pattern), context.rules.read) : allow;
}

function searchedFolderDecision(context: StepContext, folder: string): Decision {
  const target = resolveTarget(folder, workingFolder(context.call, context.places), context.facts);
  if (target.kind === "refused") {
    return deny(`${context.call.tool} in ${folder} for step ${context.name}: ${target.why}`);
  }
  const held = protectedLocations(context.places, context.facts).find((location) =>
    [target.written, target.real].some((path) => isInsideIgnoringCase(location, path)),
  );
  if (held === undefined) {
    return allow;
  }
  return deny(
    `${context.call.tool} in ${target.written} for step ${context.name}: that folder holds ${held}, ` +
      "which is closed to every skill step, so search a folder below it",
  );
}

function searchDecision(context: StepContext): Decision {
  const { call, places } = context;
  const path = call.input["path"];
  if (path !== undefined && typeof path !== "string") {
    return deny(`${call.tool} for step ${context.name}: the search path is not text`);
  }
  const folder = path ?? workingFolder(call, places);
  const patternField = call.tool === "Glob" ? "pattern" : "glob";
  if (call.tool === "Glob" && typeof call.input["pattern"] !== "string") {
    return deny(`Glob for step ${context.name}: the call names no pattern text`);
  }
  const checks = [
    () => folderDecision(context, folder, context.rules.read),
    () => searchedFolderDecision(context, folder),
    () => patternDecision(context, call.input[patternField]),
  ];
  for (const check of checks) {
    const decision = check();
    if (decision.verdict === "deny") {
      return decision;
    }
  }
  return allow;
}

function commandDecision(context: StepContext): Decision {
  const command = context.call.input["command"];
  if (typeof command !== "string") {
    return deny(`Bash for step ${context.name}: the call names no command text`);
  }
  const checked = checkCommand(command, context.rules.commands);
  if (checked.kind === "listed") {
    return allow;
  }
  const shown = JSON.stringify(command.length > 200 ? `${command.slice(0, 200)}...` : command);
  return stepDenial(
    context,
    `Bash ${shown}`,
    `${checked.why}, and the step may run only ${listed(context.rules.commands)}`,
  );
}

function stepDecision(context: StepContext): Decision {
  const { call, rules } = context;
  if (!rules.tools.includes(call.tool)) {
    return stepDenial(context, call.tool, `the step may use only the tools ${listed(rules.tools)}`);
  }
  switch (toolKind(call.tool)) {
    case "read":
      return fileDecision(context, rules.read);
    case "write":
      return fileDecision(context, rules.write);
    case "search":
      return searchDecision(context);
    case "command":
      return commandDecision(context);
    case "kernel":
      return allow;
    case "other":
      return stepDenial(context, call.tool, "agentbay skill steps use only file, search, command and kernel tools");
  }
}

export function decide(setup: GuardSetup, payload: unknown, facts: PathFacts): Decision {
  const reading = readPayload(payload);
  if (reading.kind === "malformed") {
    return deny(`this tool call: ${reading.reason}, so the hook cannot tell who asked or what for`);
  }
  const { call } = reading;
  const places = placesOf(setup);
  const caller = identify(setup, call);
  switch (caller.kind) {
    case "owner":
      return ownerDecision(call, places, facts);
    case "unverifiable":
      return deny(`${call.tool} for subagent ${caller.name}: ${caller.reason}`);
    case "stranger":
      return deny(
        `${call.tool} for subagent ${caller.name}: only the agentbay skill-step agents in .agentbay/steps.json ` +
          "may act in this project, and no manifest line allows another subagent",
      );
    case "step":
      return stepDecision({ call, name: caller.name, rules: caller.rules, places, facts });
  }
}
