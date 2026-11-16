import type { Budget } from "./generated/mode.ts";

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export type Effect = "read" | "write" | "network" | "spend" | "delete";

export type Tier = "fast" | "balanced" | "deep";

export const measures = ["items", "usd", "tokens", "minutes"] as const;

export type Spend = {
  readonly items: number;
  readonly usd: number;
  readonly tokens: number;
  readonly minutes: number;
};

export type ModeGrants = {
  readonly mode: string;
  readonly modeFolder: string;
  readonly databaseFile: string;
  readonly migrationsFolder: string;
  readonly readPaths: readonly string[];
  readonly writePaths: readonly string[];
  readonly throwawayPaths: readonly string[];
  readonly secrets: readonly string[];
  readonly hosts: readonly string[];
  readonly commands: readonly string[];
};

export type Permissions = {
  readonly grants: ModeGrants;
  readonly actionEffects: readonly Effect[];
};

export type CommandRequest = {
  readonly command: readonly string[];
  readonly folder: string;
  readonly timeLimitSeconds: number;
};

export type CommandEnd =
  | { readonly how: "exited"; readonly exitCode: number }
  | { readonly how: "signalled"; readonly signal: string }
  | { readonly how: "timed-out" };

export type CommandOutput = {
  readonly text: string;
  readonly cut: boolean;
};

export type CommandRan = {
  readonly end: CommandEnd;
  readonly milliseconds: number;
  readonly stdout: CommandOutput;
  readonly stderr: CommandOutput;
};

export type StepPlace = {
  readonly runId: string;
  readonly mode: string;
  readonly action: string;
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

export type Settled =
  { readonly status: "done"; readonly output: Json } | { readonly status: "failed"; readonly reason: string };

export type StepOutcome = Settled & { readonly spent: Spend };

export type ScriptRunner = {
  readonly run: (request: ScriptRequest) => Promise<StepOutcome>;
};

export type Submission = {
  readonly output: Json;
  readonly spent: Spend;
};

export type Scrubber = {
  readonly redact: (text: string) => string;
  readonly redactJson: (value: Json) => Json;
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
