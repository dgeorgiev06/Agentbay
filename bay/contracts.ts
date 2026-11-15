import type { Budget } from "./generated/mode.ts";

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export type Effect = "read" | "write" | "network" | "spend" | "delete";

export type Tier = "fast" | "balanced" | "deep";

export type Spend = {
  readonly items: number;
  readonly usd: number;
  readonly tokens: number;
  readonly minutes: number;
};

export type Permissions = {
  readonly mode: string;
  readonly modeFolder: string;
  readonly databaseFile: string;
  readonly migrationsFolder: string;
  readonly readPaths: readonly string[];
  readonly writePaths: readonly string[];
  readonly secrets: readonly string[];
  readonly hosts: readonly string[];
  readonly commands: readonly string[];
  readonly effects: readonly Effect[];
};

export type StepPlace = {
  readonly runId: string;
  readonly mode: string;
  readonly action: string;
  readonly stepIndex: number;
  readonly stepKey: string;
};

export type ActionCaller = (reference: string, input: Json) => Promise<StepOutcome>;

export type ScriptRequest = {
  readonly place: StepPlace;
  readonly script: string;
  readonly input: Json;
  readonly permissions: Permissions;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly remaining: Budget;
  readonly timeLimitMilliseconds: number;
  readonly call: ActionCaller;
  readonly caller?: string;
  readonly skillInput?: Json;
};

export type StepOutcome =
  | { readonly status: "done"; readonly output: Json; readonly spent: Spend }
  | { readonly status: "failed"; readonly reason: string; readonly spent: Spend };

export type ScriptRunner = {
  readonly run: (request: ScriptRequest) => Promise<StepOutcome>;
};

export type SkillTask = {
  readonly place: StepPlace;
  readonly skill: string;
  readonly tier: Tier;
  readonly input: Json;
  readonly outputSchema: string;
  readonly permissions: Permissions;
  readonly round: number;
  readonly feedback: readonly string[];
};

export type Submission = {
  readonly output: Json;
  readonly spent: Spend;
};

export type Scrubber = {
  readonly redact: (text: string) => string;
};

export type RunEvent = {
  readonly at: string;
  readonly runId: string;
  readonly kind: string;
  readonly detail: Json;
};

export type EventSink = {
  readonly append: (event: RunEvent) => Promise<void>;
};

export type PolicyOf = (mode: string) => Permissions;
