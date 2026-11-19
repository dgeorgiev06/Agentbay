import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";
import { gitSucceeded, nulFields } from "./git.ts";

export type Difference =
  | { readonly path: string; readonly how: "added" }
  | { readonly path: string; readonly how: "modified" }
  | { readonly path: string; readonly how: "deleted" }
  | { readonly path: string; readonly how: "renamed"; readonly from: string };

type Read = { readonly difference: Difference; readonly fieldsUsed: number };

function field(fields: readonly string[], index: number): string {
  return fields[index] ?? fail("git diff-tree ended in the middle of an entry, so the mode cannot read it.");
}

function readDifference(fields: readonly string[], index: number): Read {
  const status = field(fields, index);
  const path = field(fields, index + 1);
  if (status.startsWith("R")) {
    return {
      difference: {
        path: field(fields, index + 2),
        how: "renamed",
        from: path,
      },
      fieldsUsed: 3,
    };
  }
  switch (status) {
    case "A":
      return { difference: { path, how: "added" }, fieldsUsed: 2 };
    case "M":
    case "T":
      return { difference: { path, how: "modified" }, fieldsUsed: 2 };
    case "D":
      return { difference: { path, how: "deleted" }, fieldsUsed: 2 };
    default:
      return fail(`git diff-tree gave the status ${status} for ${path}, which the mode does not read.`);
  }
}

function differencesOf(output: string): readonly Difference[] {
  const fields = nulFields(output);
  const differences: Difference[] = [];
  for (let index = 0; index < fields.length;) {
    const read = readDifference(fields, index);
    differences.push(read.difference);
    index += read.fieldsUsed;
  }
  return differences;
}

export async function differencesBetween(
  context: ScriptContext,
  commits: { readonly from: string; readonly to: string },
): Promise<readonly Difference[]> {
  return differencesOf(await gitSucceeded(context, ".", ["changed-paths", commits.from, commits.to]));
}
