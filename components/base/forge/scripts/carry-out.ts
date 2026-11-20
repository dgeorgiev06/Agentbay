import { defineScript, fail, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { branchesAfter, branchesSaid, type SliceWork } from "./lib/branch-endings.ts";
import { answerOf } from "./lib/called.ts";
import { settled } from "./lib/drops.ts";
import { headMerged } from "./lib/merge-head.ts";

type Request = {
  readonly choice: "merge" | "send-back" | "keep" | "discard";
  readonly name: string;
  readonly branch: string;
  readonly work: string;
  readonly head: string;
  readonly into: string;
  readonly folder?: string;
};

const choices: readonly Request["choice"][] = ["merge", "send-back", "keep", "discard"];

function requestOf(input: Json): Request {
  const fields = fieldsOf(input);
  const text = (key: Exclude<keyof Request, "choice" | "folder">): string => {
    const value = fields[key];
    return typeof value === "string" ? value : "";
  };
  const choice = choices.find((name) => name === fields.choice);
  if (choice === undefined) {
    return fail(`carry-out was given no choice it knows; it knows ${choices.join(", ")}.`);
  }
  const named = {
    choice,
    name: text("name"),
    branch: text("branch"),
    work: text("work"),
    head: text("head"),
    into: text("into"),
  };
  return typeof fields.folder === "string" ? { ...named, folder: fields.folder } : named;
}

function workOf(request: Request): SliceWork {
  return { builder: request.branch, head: request.work };
}

async function merged(context: ScriptContext, request: Request): Promise<Json> {
  const commit = await headMerged(context, { cutAs: request.name, head: request.head, into: request.into });
  if (request.folder !== undefined) {
    await answerOf(context, "worktrees.remove", { folder: request.folder, branchAfter: "kept" });
  }
  const ending = { kind: "merged", name: request.name, work: workOf(request) } as const;
  const drops = await settled(context, branchesAfter(ending), request.into);
  return { choice: "merge", merged: commit, into: request.into, ...branchesSaid([], drops.stayed) };
}

export const run = defineScript(async (input, context) => {
  const request = requestOf(input);
  switch (request.choice) {
    case "merge":
      return merged(context, request);
    case "keep":
      return { choice: "keep", kept: [...branchesAfter({ kind: "kept", work: workOf(request) }).keep] };
    case "send-back":
    case "discard":
      return fail(`The choice ${request.choice} is withheld in this slice, so carry-out has nothing to do for it.`);
  }
});
