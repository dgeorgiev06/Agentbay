import { isAbsolute, join, normalize } from "node:path";
import { agentWritableFolders, type Layout, type SkillAgent } from "../../bay/adapter.ts";
import { toolsFor } from "./agent-file.ts";
import type { StepRules, StepsFile } from "./guard-input.ts";

function absolutePaths(project: string, paths: readonly string[]): readonly string[] {
  return paths.map((path) => normalize(isAbsolute(path) ? path : join(project, path)));
}

function rulesOf(agent: SkillAgent, project: string): StepRules {
  return {
    mode: agent.mode,
    skill: agent.skill,
    tools: toolsFor(agent),
    read: absolutePaths(project, agent.grants.readPaths),
    write: absolutePaths(project, agentWritableFolders(agent)),
    commands: agent.grants.commands,
  };
}

export function stepsFileText(layout: Layout, agents: readonly SkillAgent[]): string {
  const { project, kit } = layout;
  const steps: StepsFile = {
    version: 1,
    project,
    kit,
    agents: Object.fromEntries(agents.map((agent) => [agent.agent, rulesOf(agent, project)])),
  };
  return `${JSON.stringify(steps, null, 2)}\n`;
}
