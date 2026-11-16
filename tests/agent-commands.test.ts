import assert from "node:assert/strict";
import { test } from "node:test";
import { agentCommands, type SkillAgent } from "../bay/adapter.ts";
import type { Effect } from "../bay/contracts.ts";
import { grantsIn } from "./broker-fixture.ts";

function agentWith(effects: readonly Effect[]): SkillAgent {
  return {
    agent: "agentbay-notes-draft",
    mode: "notes",
    skill: "draft",
    skillFile: "/project/components/modes/notes/skills/draft/SKILL.md",
    description: "Drafts a note.",
    tier: "fast",
    kernelTools: [],
    grants: grantsIn("/project", { commands: ["git status"] }),
    effects,
  };
}

test("an agent is given its mode's commands only when its action declares all five effects", () => {
  const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];
  assert.deepEqual(agentCommands(agentWith(everyEffect)), ["git status"]);
  for (const missing of everyEffect) {
    assert.deepEqual(agentCommands(agentWith(everyEffect.filter((effect) => effect !== missing))), [], missing);
  }
});
