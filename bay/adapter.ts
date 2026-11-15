import type { Permissions, Tier } from "./contracts.ts";
import type { Layout } from "./layout.ts";
import type { FileSystem, Removal } from "./ports.ts";
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
