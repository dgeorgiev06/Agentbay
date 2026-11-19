export type Config = {
  readonly bindings: Readonly<Record<string, Binding>>;
  readonly adapter: Name;
  readonly modes?: ReadonlyArray<Name>;
  readonly settings?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly budget?: Budget;
  readonly tiers?: { readonly fast?: TierSetting; readonly balanced?: TierSetting; readonly deep?: TierSetting };
  readonly skillSteps?: { readonly run?: "with-the-hook" | "without-the-hook" };
  readonly approvals?: { readonly from?: ReadonlyArray<"terminal" | "chat"> };
};

export type Binding = Name | BindingMap;

export type BindingMap = Readonly<Record<string, Name>>;

export type Name = string;

export type TierSetting = { readonly model: string; readonly effort?: "low" | "medium" | "high" | "xhigh" | "max" };

export type Budget = {
  readonly items?: number;
  readonly usd?: number;
  readonly tokens?: number;
  readonly minutes?: number;
};
