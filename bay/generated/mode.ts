export type Mode = {
  readonly name: Name;
  readonly version: string;
  readonly description: string;
  readonly requires?: { readonly interfaces: ReadonlyArray<InterfaceReference> };
  readonly implements?: ReadonlyArray<InterfaceReference>;
  readonly resources?: Resources;
  readonly actions: Readonly<Record<string, Action>>;
  readonly workflows?: ReadonlyArray<RelativePath>;
};

export type Name = string;

export type InterfaceReference = string;

export type RelativePath = string;

export type Effect = "read" | "write" | "network" | "spend" | "delete";

export type Budget = {
  readonly items?: number;
  readonly usd?: number;
  readonly tokens?: number;
  readonly minutes?: number;
};

export type Resources = {
  readonly db?: { readonly migrations: RelativePath };
  readonly files?: { readonly read?: ReadonlyArray<string>; readonly write?: ReadonlyArray<string> };
  readonly secrets?: ReadonlyArray<string>;
  readonly network?: ReadonlyArray<string>;
  readonly commands?: ReadonlyArray<string>;
};

export type Action = {
  readonly input: RelativePath;
  readonly output: RelativePath;
  readonly effects: ReadonlyArray<Effect>;
  readonly run: ReadonlyArray<Step>;
  readonly undo?: Name;
  readonly budget?: Budget;
};

export type Step =
  | { readonly script: RelativePath }
  | { readonly skill: RelativePath; readonly tier: "fast" | "balanced" | "deep" }
  | { readonly call: string };
