import type { Effect, ModeGrants, Tier } from "./contracts.ts";
import { grantedCommands, writableFolders } from "./effect-rule.ts";
import type { Layout } from "./layout.ts";
import type { FileSystem, Removal } from "./ports.ts";
import type { System } from "./manifests/registry.ts";
import type { Outcome } from "./outcome.ts";

export type SkillAgent = {
  readonly agent: string;
  readonly mode: string;
  readonly skill: string;
  readonly skillFile: string;
  readonly description: string;
  readonly tier: Tier;
  readonly kernelTools: readonly string[];
  readonly grants: ModeGrants;
  readonly effects: readonly Effect[];
};

export type { Layout } from "./layout.ts";

export type BuildRequest = {
  readonly system: System;
  readonly layout: Layout;
  readonly agents: readonly SkillAgent[];
  readonly files: FileSystem;
  readonly removal: Removal;
};

export type CleanRequest = {
  readonly layout: Layout;
  readonly files: FileSystem;
  readonly removal: Removal;
};

export type Adapter = {
  readonly name: string;
  readonly build: (request: BuildRequest) => Promise<Outcome<readonly string[]>>;
  readonly clean: (request: CleanRequest) => Promise<Outcome<readonly string[]>>;
};

export function agentName(mode: string, skill: string): string {
  return `agentbay-${mode}-${skill}`;
}

export function agentWritableFolders(agent: SkillAgent): readonly string[] {
  return writableFolders({ grants: agent.grants, actionEffects: agent.effects });
}

export function agentCommands(agent: SkillAgent): readonly string[] {
  return grantedCommands({ grants: agent.grants, actionEffects: agent.effects });
}
