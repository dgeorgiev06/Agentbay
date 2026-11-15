export type Config = {
  readonly bindings: Readonly<Record<string, Name>>;
  readonly adapter: Name;
  readonly settings?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly budget?: Budget;
  readonly approvals?: { readonly from?: ReadonlyArray<"terminal" | "chat"> };
};

export type Name = string;

export type Budget = {
  readonly items?: number;
  readonly usd?: number;
  readonly tokens?: number;
  readonly minutes?: number;
};
