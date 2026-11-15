export type Workflow = {
  readonly name: Name;
  readonly trigger?: { readonly event: string } | { readonly schedule: string } | { readonly manual: true };
  readonly budget?: Budget;
  readonly steps: ReadonlyArray<Step>;
};

export type Name = string;

export type Reference = string;

export type Budget = {
  readonly items?: number;
  readonly usd?: number;
  readonly tokens?: number;
  readonly minutes?: number;
};

export type Step =
  | { readonly action: string; readonly input?: Readonly<Record<string, unknown>>; readonly id: Name }
  | { readonly approval: string; readonly show?: Reference; readonly id: Name }
  | { readonly wait: string; readonly id: Name }
  | { readonly foreach: Reference; readonly id: Name; readonly steps: ReadonlyArray<Step> };
