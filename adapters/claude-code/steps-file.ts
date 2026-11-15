import { isAbsolute, join, normalize } from "node:path";
import type { SkillAgent } from "../../bay/adapter.ts";
import { toolsFor } from "./agent-file.ts";
import { alwaysDeniedNames, kitFolders, type StepRules, type StepsFile } from "./guard-input.ts";

function absolutePaths(root: string, paths: readonly string[]): readonly string[] {
  return paths.map((path) => normalize(isAbsolute(path) ? path : join(root, path)));
}

function rulesOf(agent: SkillAgent, root: string): StepRules {
  return {
    mode: agent.mode,
    skill: agent.skill,
    tools: toolsFor(agent),
    read: absolutePaths(root, agent.permissions.readPaths),
    write: absolutePaths(root, agent.permissions.writePaths),
    commands: agent.permissions.commands,
  };
}

export function stepsFileText(root: string, kit: string, agents: readonly SkillAgent[]): string {
  const steps: StepsFile = {
    version: 1,
    root,
    kit,
    alwaysDenied: { names: alwaysDeniedNames, kitFolders },
    agents: Object.fromEntries(agents.map((agent) => [agent.agent, rulesOf(agent, root)])),
  };
  return `${JSON.stringify(steps, null, 2)}\n`;
}
