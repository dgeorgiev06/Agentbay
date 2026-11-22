import { basename, dirname, join } from "node:path/posix";
import { pathMatch } from "../../../../../bay/sdk.ts";
import type { Slice } from "./slice-form.ts";

export type Declaring = {
  readonly kind: Slice["kind"];
  readonly scope: readonly string[];
  readonly fixed: readonly string[];
  readonly interface: readonly string[];
  readonly files: readonly string[];
};

const manifestName = "mode.yaml";

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

function modeFolders(files: readonly string[]): readonly string[] {
  return files.filter((file) => basename(file) === manifestName).map(dirname);
}

function isSchemaFile(file: string): boolean {
  return file.endsWith(".json");
}

function hasOwnSchema(folder: string, files: readonly string[]): boolean {
  return files.some((file) => dirname(file) === join(folder, "schemas") && isSchemaFile(file));
}

function schemasLeftOut(declaring: Declaring): readonly string[] {
  const designed = declaring.interface.filter(isSchemaFile);
  if (declaring.kind !== "mode" || designed.length === 0) {
    return [];
  }
  return modeFolders(declaring.files)
    .filter((folder) => !hasOwnSchema(folder, declaring.files))
    .map((folder) => {
      const copies = [...new Set(designed.map((file) => join(folder, "schemas", basename(file))))];
      return (
        `The declaration lists no schema file in the mode's folder ${folder}, and its ${manifestName} may name ` +
        `only files inside that folder: add ${copies.join(", ")}, each a copy of the design's file of that name.`
      );
    });
}

export function refusedDeclaration(declaring: Declaring): readonly string[] {
  return [...outsideScope(declaring), ...fixedNamed(declaring), ...schemasLeftOut(declaring)];
}
