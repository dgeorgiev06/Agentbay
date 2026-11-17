import assert from "node:assert/strict";
import { test } from "node:test";
import { agentCommands, type SkillAgent } from "../bay/adapter.ts";
import type { Effect, ModeGrants } from "../bay/contracts.ts";
import { layoutOf } from "../bay/layout.ts";
import { grantsOf } from "../bay/policy.ts";
import { grantsIn, modeNamed } from "./broker-fixture.ts";
import { grantedCommand } from "./grants-fixture.ts";

const commands = [
  grantedCommand("changes", "git status --porcelain", ["read"]),
  grantedCommand("commit-staged", "git commit --quiet", ["read", "write"]),
  grantedCommand("remove-worktree", "git worktree remove", ["write", "delete"]),
  grantedCommand("fetch", "git fetch", ["read", "network"]),
];

function agentWith(effects: readonly Effect[], grants: ModeGrants = grantsIn("/project", { commands })): SkillAgent {
  return {
    agent: "agentbay-notes-draft",
    mode: "notes",
    skill: "draft",
    skillFile: "/project/components/modes/notes/skills/draft/SKILL.md",
    description: "Drafts a note.",
    tier: "fast",
    kernelTools: [],
    grants,
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

function grantsOfManifest(resources: Parameters<typeof modeNamed>[1]): ModeGrants {
  const ruling = grantsOf({
    manifest: modeNamed("notes", resources),
    home: "kit",
    folder: "/project/components/base/notes",
    layout: layoutOf({ kit: "/project", project: "/project" }),
    otherModes: [],
  });
  assert.ok(ruling.ok, JSON.stringify(ruling));
  return ruling.value;
}

test("an agent is given each command as the words its mode's commands start with, then its own words", () => {
  const grants = grantsOfManifest({
    commandsStartWith: "git -c core.hooksPath=/dev/null",
    commands: {
      changes: { run: "status --porcelain --", effects: ["read"] },
      "remove-worktree": { run: "worktree remove --end-of-options", effects: ["read", "delete"] },
    },
  });
  assert.deepEqual(agentCommands(agentWith(["read"], grants)), [
    "git -c core.hooksPath=/dev/null status --porcelain --",
  ]);
  assert.deepEqual(agentCommands(agentWith(["read", "delete"], grants)), [
    "git -c core.hooksPath=/dev/null status --porcelain --",
    "git -c core.hooksPath=/dev/null worktree remove --end-of-options",
  ]);
});
