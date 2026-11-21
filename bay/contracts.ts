import type { Budget } from "./generated/mode.ts";
import type { Problem } from "./outcome.ts";

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export type Effect = "read" | "write" | "network" | "spend" | "delete";

export const tiers = ["fast", "balanced", "deep"] as const;

export type Tier = (typeof tiers)[number];

export const measures = ["items", "usd", "tokens", "minutes"] as const;

export type Spend = {
  readonly items: number;
  readonly usd: number;
  readonly tokens: number;
  readonly minutes: number;
};

export type GrantedCommand = {
  readonly name: string;
  readonly words: readonly string[];
  readonly effects: readonly Effect[];
};

export type ModeList = {
  readonly mode: string;
  readonly commands: readonly GrantedCommand[];
  readonly commandsStartWith: readonly string[];
  readonly throwaway: readonly string[];
};

export type ScriptFiles = Readonly<Record<string, string>>;

export type TrustGiven = {
  readonly list: ModeList;
  readonly hash: string;
  readonly scripts: ScriptFiles;
  readonly at: string;
  readonly by: string;
};

export type ListTrust =
  | { readonly state: "not needed" }
  | { readonly state: "trusted"; readonly given: TrustGiven }
  | { readonly state: "never trusted"; readonly list: ModeList }
  | { readonly state: "changed"; readonly list: ModeList; readonly given: TrustGiven }
  | { readonly state: "unreadable record"; readonly list: ModeList; readonly problems: readonly Problem[] };

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
  readonly commands: readonly GrantedCommand[];
  readonly listTrust: ListTrust;
};

export type Permissions = {
  readonly grants: ModeGrants;
  readonly actionEffects: readonly Effect[];
};

export type StepPlace = {
  readonly runId: string;
  readonly mode: string;
  readonly action: string;
  readonly stepKey: string;
};

export type ActionCaller = (reference: string, input: Json) => Promise<StepOutcome>;

export const defaultScriptTimeLimitSeconds = 480;

export type StepTimeLimit = {
  readonly timeLimitMilliseconds: number;
  readonly timeLimitSetBy: "kernel" | "action" | "budget";
};

export type ScriptRequest = StepTimeLimit & {
  readonly place: StepPlace;
  readonly script: string;
  readonly input: Json;
  readonly permissions: Permissions;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly remaining: Budget;
  readonly call: ActionCaller;
  readonly random: RandomDrawer;
  readonly startedAt: Date;
  readonly caller?: string;
  readonly skillInput?: Json;
};

export type Drawn =
  { readonly status: "done"; readonly value: string } | { readonly status: "failed"; readonly reason: string };

export type RandomDrawer = (bytes: number) => Promise<Drawn>;

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
