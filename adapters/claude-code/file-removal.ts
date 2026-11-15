import type { Files, Problem } from "./adapter-types.ts";

export type RemovableFiles = Files & { readonly remove: (path: string) => Promise<void> };

export function canRemove(files: Files): files is RemovableFiles {
  return "remove" in files && typeof files.remove === "function";
}

export function removalProblem(file: string): Problem {
  return {
    file,
    path: "",
    message: "this file port cannot delete files, so the adapter cannot remove what an earlier build wrote",
    fix: "give the adapter a file port with remove(path), or delete the files listed in .agentbay/build.json by hand",
  };
}
