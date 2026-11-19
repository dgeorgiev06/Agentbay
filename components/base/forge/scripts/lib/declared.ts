import { pathMatch } from "../../../../../bay/sdk.ts";

export type Declaring = {
  readonly scope: readonly string[];
  readonly fixed: readonly string[];
  readonly files: readonly string[];
};

function files(count: number): string {
  return count === 1 ? "a file" : `${String(count)} files`;
}

function outsideScope(declaring: Declaring): readonly string[] {
  const { scope } = declaring;
  const outside = declaring.files.filter(
    (file) => !scope.some((pattern) => pathMatch(pattern, file).kind === "matched"),
  );
  if (outside.length === 0) {
    return [];
  }
  return [
    `The declaration names ${files(outside.length)} outside the slice's write scope: ${outside.join(", ")}. ` +
      `Declare only files the scope admits: ${scope.join(", ")}.`,
  ];
}

function fixedNamed(declaring: Declaring): readonly string[] {
  const named = declaring.files.filter((file) => declaring.fixed.includes(file));
  if (named.length === 0) {
    return [];
  }
  return [
    `The declaration names ${files(named.length)} the builder may not change: ${named.join(", ")}. ` +
      "Another agent writes the tests; leave them out.",
  ];
}

export function refusedDeclaration(declaring: Declaring): readonly string[] {
  return [...outsideScope(declaring), ...fixedNamed(declaring)];
}
