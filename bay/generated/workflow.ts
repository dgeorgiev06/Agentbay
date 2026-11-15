export type Workflow = {
  readonly name: string;
  readonly trigger?: { readonly event: string } | { readonly schedule: string } | { readonly manual: true };
  readonly budget?: Budget;
  readonly steps: ReadonlyArray<Step>;
};

export type Budget = {
  readonly items?: number;
  readonly usd?: number;
  readonly tokens?: number;
  readonly minutes?: number;
};

export type Step =
  | { readonly action: string }
  | { readonly approval: string }
  | { readonly wait: string }
  | { readonly foreach: string; readonly steps: ReadonlyArray<Step> };
