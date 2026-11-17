import assert from "node:assert/strict";
import { test } from "node:test";
import { agentCommands, type SkillAgent } from "../bay/adapter.ts";
import type { Effect } from "../bay/contracts.ts";
import { grantsIn } from "./broker-fixture.ts";
import { grantedCommand } from "./grants-fixture.ts";

const commands = [
  grantedCommand("changes", "git status --porcelain", ["read"]),
  grantedCommand("commit-staged", "git commit --quiet", ["read", "write"]),
  grantedCommand("remove-worktree", "git worktree remove", ["write", "delete"]),
  grantedCommand("fetch", "git fetch", ["read", "network"]),
];

function agentWith(effects: readonly Effect[]): SkillAgent {
  return {
    agent: "agentbay-notes-draft",
    mode: "notes",
    skill: "draft",
    skillFile: "/project/components/modes/notes/skills/draft/SKILL.md",
    description: "Drafts a note.",
    tier: "fast",
    kernelTools: [],
    grants: grantsIn("/project", { commands }),
    effects,
  };
}

test("an agent is given the commands whose effects its action declares, no more and no fewer", () => {
  assert.deepEqual(agentCommands(agentWith(["read"])), ["git status --porcelain"]);
  assert.deepEqual(agentCommands(agentWith(["write", "read"])), ["git status --porcelain", "git commit --quiet"]);
  assert.deepEqual(agentCommands(agentWith(["write", "delete"])), ["git worktree remove"]);
  assert.deepEqual(agentCommands(agentWith(["network"])), []);
  assert.deepEqual(agentCommands(agentWith([])), []);
  assert.deepEqual(agentCommands(agentWith(["read", "write", "network", "spend", "delete"])), [
    "git status --porcelain",
    "git commit --quiet",
    "git worktree remove",
    "git fetch",
  ]);
});
