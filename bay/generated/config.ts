export type Config = {
  readonly bindings: Readonly<Record<string, Binding>>;
  readonly adapter: Name;
  readonly modes?: ReadonlyArray<Name>;
  readonly settings?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly budget?: Budget;
  readonly approvals?: { readonly from?: ReadonlyArray<"terminal" | "chat"> };
};

export type Binding = Name | BindingMap;

export type BindingMap = Readonly<Record<string, Name>>;

export type Name = string;

export type Budget = {
  readonly items?: number;
  readonly usd?: number;
  readonly tokens?: number;
  readonly minutes?: number;
};
