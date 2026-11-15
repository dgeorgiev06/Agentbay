import type { Permissions, Tier } from "./contracts.ts";
import type { FileSystem } from "./ports.ts";
import type { System } from "./registry.ts";
import type { Outcome } from "./spec.ts";

export type SkillAgent = {
  readonly agent: string;
  readonly mode: string;
  readonly skill: string;
  readonly skillFile: string;
  readonly description: string;
  readonly tier: Tier;
  readonly kernelTools: readonly string[];
  readonly permissions: Permissions;
};

export type BuildRequest = {
  readonly system: System;
  readonly root: string;
  readonly kit: string;
  readonly agents: readonly SkillAgent[];
  readonly files: FileSystem;
};

export type CleanRequest = {
  readonly root: string;
  readonly files: FileSystem;
};

export type Adapter = {
  readonly name: string;
  readonly build: (request: BuildRequest) => Promise<Outcome<readonly string[]>>;
  readonly clean: (request: CleanRequest) => Promise<Outcome<readonly string[]>>;
};

export function agentName(mode: string, skill: string): string {
  return `agentbay-${mode}-${skill}`;
}
