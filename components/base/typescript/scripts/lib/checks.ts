export type Check = {
  readonly name: string;
};

export const checks: readonly Check[] = [
  { name: "generate:check" },
  { name: "typecheck" },
  { name: "lint" },
  { name: "format:check" },
  { name: "deadcode" },
];
