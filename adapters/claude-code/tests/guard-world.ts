import assert from "node:assert/strict";
import { decide, type Decision, type GuardSetup } from "../guard-decide.ts";
import { readPolicy, type StepRules, type StepsFile } from "../guard-input.ts";
import type { FolderEntry, PathFacts, PathState } from "../guard-paths.ts";

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

function childrenOf(
  folder: string,
  existing: ReadonlySet<string>,
  links: Readonly<Record<string, string>>,
): readonly FolderEntry[] {
  const prefix = folder === "/" ? "/" : `${folder}/`;
  const names = new Set(
    [...existing, ...Object.keys(links)]
      .filter((path) => path.startsWith(prefix) && path !== folder)
      .map((path) => path.slice(prefix.length).split("/")[0] ?? ""),
  );
  return [...names].sort().map((name): FolderEntry => {
    const path = `${prefix}${name}`;
    if (path in links) {
      return { name, kind: "link" };
    }
    return { name, kind: [...existing].some((known) => known.startsWith(`${path}/`)) ? "folder" : "other" };
  });
}

function fakeWorld(shape: WorldShape): PathFacts {
  const existing = new Set(["/", ...shape.existing]);
  return {
    entries: (folder: string) => (existing.has(folder) ? childrenOf(folder, existing, shape.links) : undefined),
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
    "/p/clean",
    "/p/clean/a.md",
    "/p/clean/drafts",
    "/p/clean/drafts/b.md",
    "/p/vault",
    "/p/vault/.env",
    "/p/vault/.env.local",
    "/p/vault/.git",
    "/p/vault/.git/config",
    "/p/vault/plain.md",
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
    "/k/components/base",
    "/k/components/base/forge",
    "/k/components/base/forge/mode.yaml",
    "/k/components/base/forge/scripts",
    "/k/components/base/forge/scripts/merge.ts",
    "/etc",
    "/etc/passwd",
  ],
  links: {
    "/p/notes/escape": "/etc",
    "/p/elsewhere/into": "/p/notes",
    "/p/out/closed": "/p/.agentbay",
    "/p/docs": "/p/.agentbay",
    "/p/kit-base": "/k/components/base",
    "/linked/kit": "/k",
  },
  broken: ["/p/out/dangling"],
});

const digest: StepRules = {
  mode: "mail",
  skill: "digest",
  tools: ["Read", "Glob", "Grep", "Write", "Edit", "MultiEdit", "NotebookEdit", "mcp__agentbay__submit"],
  read: ["/k/components/mail", "/p/notes", "/p/out", "/p/notes-out", "/p/clean", "/p/vault"],
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

const forge: StepRules = {
  mode: "forge",
  skill: "extend",
  tools: ["Read", "Write", "Edit", "Glob"],
  read: ["/k/bay", "/p/src"],
  write: ["/k/bay", "/p/src"],
  commands: [],
};

const wide: StepRules = {
  mode: "wide",
  skill: "everything",
  tools: ["Read", "Write"],
  read: ["/k"],
  write: ["/k", "/p"],
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
  project: "/p",
  kit: "/k",
  agents: {
    "agentbay-mail-digest": digest,
    "agentbay-forge-build": builder,
    "agentbay-store-survey": survey,
    "agentbay-odd-odd": tampered,
    "agentbay-forge-extend": forge,
    "agentbay-wide-everything": wide,
  },
};

export const setup: GuardSetup = { project: "/p", kit: "/k", policy: readPolicy(JSON.stringify(stepsFile), "/p") };

type Asked = { readonly agent: string; readonly tool: string; readonly input: Readonly<Record<string, unknown>> };

export function askIn(facts: PathFacts, asked: Asked): Decision {
  const payload = { cwd: "/p", tool_name: asked.tool, tool_input: asked.input };
  return decide(setup, { ...payload, agent_id: "agent-1", agent_type: asked.agent }, facts);
}

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
