import type { ScriptContext } from "../../../../../bay/sdk.ts";
import { gitSucceeded, nulFields } from "./git.ts";

export type Changes = {
  readonly changed: readonly string[];
  readonly untracked: readonly string[];
  readonly conflicted: readonly string[];
};

const unmergedCodes: readonly string[] = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];

export function changesOf(output: string): Changes {
  const changed: string[] = [];
  const untracked: string[] = [];
  const conflicted: string[] = [];
  const fields = nulFields(output);
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index] ?? "";
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code === "??") {
      untracked.push(path);
    } else {
      changed.push(path);
    }
    if (unmergedCodes.includes(code)) {
      conflicted.push(path);
    }
    if (code.includes("R") || code.includes("C")) {
      index += 1;
    }
  }
  return { changed, untracked, conflicted };
}

export function isClean(changes: Changes): boolean {
  return changes.changed.length === 0 && changes.untracked.length === 0;
}

export async function changesIn(context: ScriptContext, folder: string): Promise<Changes> {
  return changesOf(await gitSucceeded(context, folder, ["changes"]));
}
