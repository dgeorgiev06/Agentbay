import type { ScriptContext } from "../../../../../bay/sdk.ts";
import { gitSucceeded, nulFields } from "./git.ts";

export type Changes = {
  readonly changed: readonly string[];
  readonly untracked: readonly string[];
};

export function changesOf(output: string): Changes {
  const changed: string[] = [];
  const untracked: string[] = [];
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
    if (code.includes("R") || code.includes("C")) {
      index += 1;
    }
  }
  return { changed, untracked };
}

export async function changesIn(context: ScriptContext, folder: string): Promise<Changes> {
  const status = ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all", "--"];
  return changesOf(await gitSucceeded(context, folder, status));
}
