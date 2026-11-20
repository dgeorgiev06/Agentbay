export type SliceKind = "interface" | "capability" | "mode";

export type After = {
  readonly slice: string;
  readonly because: string;
};

export type PlannedSlice = {
  readonly name: string;
  readonly title: string;
  readonly kind: SliceKind;
  readonly scope: readonly string[];
  readonly after: readonly After[];
  readonly tests: readonly string[];
  readonly meets?: readonly string[];
  readonly interface?: readonly string[];
  readonly crossesModulesBecause?: string;
};

export type Plan = {
  readonly title: string;
  readonly slices: readonly PlannedSlice[];
  readonly oneAfterAnotherBecause?: string;
  readonly requirements?: string;
  readonly design?: string;
};

export type Feature = {
  readonly name: string;
  readonly private: readonly string[];
};
