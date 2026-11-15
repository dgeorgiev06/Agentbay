export type Interface = {
  readonly name: Name;
  readonly version: number;
  readonly actions: Readonly<Record<string, Signature>>;
};

export type Name = string;

export type RelativePath = string;

export type Effect = "read" | "write" | "network" | "spend" | "delete";

export type Signature = {
  readonly input: RelativePath;
  readonly output: RelativePath;
  readonly effects: ReadonlyArray<Effect>;
};
