import assert from "node:assert/strict";
import { decide, type Decision, type GuardSetup } from "../guard-decide.ts";
import { readPolicy, type StepRules, type StepsFile } from "../guard-input.ts";
import type { PathFacts, PathState } from "../guard-paths.ts";

type WorldShape = {
  readonly existing: readonly string[];
  readonly links: Readonly<Record<string, string>>;
  readonly broken: readonly string[];
};

function followLinks(path: string, links: Readonly<Record<string, string>>): string {
  const link = Object.keys(links)
    .filter((from) => path === from || path.startsWith(`${from}/`))
    .sort((left, right) => right.length - left.length)[0];
  return link === undefined ? path : `${links[link] ?? ""}${path.slice(link.length)}`;
}

function fakeWorld(shape: WorldShape): PathFacts {
  const existing = new Set(["/", ...shape.existing]);
  return {
    inspect: (path: string): PathState => {
      if (shape.broken.includes(path)) {
        return { kind: "unresolvable" };
      }
      const real = followLinks(path, shape.links);
      return existing.has(real) ? { kind: "exists", realPath: real } : { kind: "missing" };
    },
  };
}

export const world = fakeWorld({
  existing: [
    "/p",
    "/p/notes",
    "/p/notes/a.md",
    "/p/out",
    "/p/notes-out",
    "/p/notes-out2",
    "/p/src",
    "/p/src/app.ts",
    "/p/elsewhere",
    "/p/.agentbay",
    "/p/.agentbay/steps.json",
    "/p/.claude",
    "/p/sub",
    "/p/sub/.git",
    "/k",
    "/k/bay",
    "/k/bay/sdk.ts",
    "/k/components",
    "/k/components/mail",
    "/etc",
    "/etc/passwd",
  ],
  links: {
    "/p/notes/escape": "/etc",
    "/p/elsewhere/into": "/p/notes",
    "/p/out/closed": "/p/.agentbay",
    "/p/docs": "/p/.agentbay",
  },
  broken: ["/p/out/dangling"],
});

const digest: StepRules = {
  mode: "mail",
  skill: "digest",
  tools: ["Read", "Glob", "Grep", "Write", "Edit", "MultiEdit", "NotebookEdit", "mcp__agentbay__submit"],
  read: ["/k/components/mail", "/p/notes", "/p/out", "/p/notes-out"],
  write: ["/p/out", "/p/notes-out"],
  commands: [],
};

const builder: StepRules = {
  mode: "forge",
  skill: "build",
  tools: ["Read", "Bash", "mcp__agentbay__submit"],
  read: ["/p/src"],
  write: ["/p/src"],
  commands: ["node --test", "git status"],
};

const survey: StepRules = {
  mode: "store",
  skill: "survey",
  tools: ["Read", "Glob", "Grep"],
  read: ["/p", "/k"],
  write: [],
  commands: [],
};

const tampered: StepRules = {
  mode: "odd",
  skill: "odd",
  tools: ["mcp__other__fetch", "WebFetch", "Agent", "TodoWrite"],
  read: ["/p"],
  write: ["/p"],
  commands: [],
};

export const stepsFile: StepsFile = {
  version: 1,
  root: "/p",
  kit: "/k",
  alwaysDenied: { names: [], kitFolders: [] },
  agents: {
    "agentbay-mail-digest": digest,
    "agentbay-forge-build": builder,
    "agentbay-store-survey": survey,
    "agentbay-odd-odd": tampered,
  },
};

export const setup: GuardSetup = { root: "/p", kit: "/k", policy: readPolicy(JSON.stringify(stepsFile), "/p") };

export function ask(agent: string | undefined, tool: string, input: Readonly<Record<string, unknown>>): Decision {
  const identity = agent === undefined ? {} : { agent_id: "agent-1", agent_type: agent };
  const payload = { session_id: "s", cwd: "/p", hook_event_name: "PreToolUse", tool_name: tool, tool_input: input };
  return decide(setup, { ...payload, ...identity }, world);
}

export function assertAllowed(decision: Decision, label = ""): void {
  assert.deepEqual(decision, { verdict: "allow" }, label);
}

export function assertDenied(decision: Decision, fragment = "", label = ""): void {
  assert.equal(decision.verdict, "deny", label);
  assert.ok(decision.reason.startsWith("agentbay denied "), decision.reason);
  assert.ok(decision.reason.includes(fragment), `${label}: "${decision.reason}" lacks "${fragment}"`);
  assert.ok(decision.reason.endsWith("."), decision.reason);
}
