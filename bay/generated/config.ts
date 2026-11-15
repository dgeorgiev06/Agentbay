export type Config = {
  readonly bindings: Readonly<Record<string, Name>>;
  readonly adapter: Name;
  readonly budget?: Budget;
};

export type Name = string;

export type Budget = {
  readonly items?: number;
  readonly usd?: number;
  readonly tokens?: number;
  readonly minutes?: number;
};
