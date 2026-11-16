import { fail } from "../../../../bay/sdk.ts";
import { commitOf, gitSucceeded, nulFields } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

type Change =
  | { readonly path: string; readonly how: "added" }
  | { readonly path: string; readonly how: "modified" }
  | { readonly path: string; readonly how: "deleted" }
  | { readonly path: string; readonly how: "renamed"; readonly from: string };

type Read = { readonly change: Change; readonly fieldsUsed: number };

function field(fields: readonly string[], index: number): string {
  return fields[index] ?? fail("git diff ended in the middle of an entry, so the mode cannot read it.");
}

function readChange(fields: readonly string[], index: number): Read {
  const status = field(fields, index);
  const path = field(fields, index + 1);
  if (status.startsWith("R")) {
    return { change: { path: field(fields, index + 2), how: "renamed", from: path }, fieldsUsed: 3 };
  }
  switch (status) {
    case "A":
      return { change: { path, how: "added" }, fieldsUsed: 2 };
    case "M":
    case "T":
      return { change: { path, how: "modified" }, fieldsUsed: 2 };
    case "D":
      return { change: { path, how: "deleted" }, fieldsUsed: 2 };
    default:
      return fail(`git diff gave the status ${status} for ${path}, which the mode does not read.`);
  }
}

function changesOf(output: string): readonly Change[] {
  const fields = nulFields(output);
  const changes: Change[] = [];
  for (let index = 0; index < fields.length;) {
    const read = readChange(fields, index);
    changes.push(read.change);
    index += read.fieldsUsed;
  }
  return changes;
}

const diff = [
  "diff",
  "--name-status",
  "-z",
  "-M",
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--no-relative",
  "--end-of-options",
];

export const run = defineRequestScript(async (request, context) => {
  const from = await commitOf(context, ".", request.text("from"));
  const to = await commitOf(context, ".", request.text("to"));
  return { paths: changesOf(await gitSucceeded(context, ".", [...diff, from, to])) };
});
