import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";

const subcommands = {
  "commit-of": "rev-parse",
  "repository-filters": "config",
  "add-detached-worktree": "worktree",
  "make-branch": "branch",
  "switch-branch": "switch",
  changes: "status",
  "commits-between": "log",
  "changed-paths": "diff-tree",
  "is-ignored": "check-ignore",
  "paths-at-commit": "ls-tree",
  "untracked-paths": "ls-files",
  "restore-paths": "restore",
  "is-ancestor": "merge-base",
  "remove-worktree": "worktree",
  "delete-branch": "branch",
  "add-worktree": "worktree",
  "merge-branch": "merge",
  "abort-merge": "merge",
  "stage-everything": "add",
  "commit-staged": "commit",
  "filters-of-paths": "check-attr",
  "apply-patch": "apply",
  "make-repository": "init",
  "repository-top": "rev-parse",
  "forget-paths": "rm",
  "stage-paths": "add",
  "checked-out-branch": "symbolic-ref",
  "merge-uncommitted": "merge",
  "fast-forward": "merge",
} as const;

export type GitCommand = keyof typeof subcommands;

export type GitCall = readonly [GitCommand, ...(readonly string[])];

const timeLimitSeconds = 300;

export type GitEnd = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

const changesTheCheckout: readonly string[] = ["restore", "switch", "merge", "add", "commit", "apply", "init", "rm"];

function isUnderForge(folder: string): boolean {
  return folder.startsWith(".forge/") && !folder.split("/").includes("..");
}

const projectsOwnFolder = ".";

function refuseInOwnersCheckout(folder: string, name: GitCommand): void {
  const subcommand = subcommands[name];
  if (name === "fast-forward") {
    if (folder !== projectsOwnFolder) {
      fail(`The mode runs git merge --ff-only only in the project's own folder, not in ${folder}.`);
    }
    return;
  }
  if (changesTheCheckout.includes(subcommand) && !isUnderForge(folder)) {
    fail(
      `The mode runs git ${subcommand} only in a folder under .forge/, not in ${folder}, ` +
        "so that the owner's checkout is never changed.",
    );
  }
}

export type Fed = {
  readonly call: GitCall;
  readonly input: string;
};

async function ran(
  context: ScriptContext,
  folder: string,
  given: { readonly call: GitCall; readonly input?: string },
): Promise<GitEnd> {
  const { call, input } = given;
  const [name, ...gitArguments] = call;
  const subcommand = subcommands[name];
  refuseInOwnersCheckout(folder, name);
  const request = { name, arguments: gitArguments, folder, timeLimitSeconds };
  const answer = await context.commands.run(input === undefined ? request : { ...request, input });
  if (!answer.ok) {
    return fail(answer.message);
  }
  const { end, stdout, stderr } = answer.value;
  const named = `git ${subcommand}`;
  switch (end.how) {
    case "timed-out":
      return fail(`${named} did not finish within ${String(timeLimitSeconds)} seconds and was stopped.`);
    case "signalled":
      return fail(`${named} was stopped by the signal ${end.signal}.`);
    case "exited":
      if (stdout.cut || stderr.cut) {
        return fail(`${named} wrote more than the kernel keeps, so the mode cannot read its output whole.`);
      }
      return { exitCode: end.exitCode, stdout: stdout.text, stderr: stderr.text };
  }
}

export function git(context: ScriptContext, folder: string, call: GitCall): Promise<GitEnd> {
  return ran(context, folder, { call });
}

export function gitFed(context: ScriptContext, folder: string, fed: Fed): Promise<GitEnd> {
  return ran(context, folder, fed);
}

export function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "") ?? "it gave no reason";
}

export function succeededOutput(ended: GitEnd, command: GitCommand): string {
  if (ended.exitCode !== 0) {
    return fail(`git ${subcommands[command]} failed: ${firstLine(ended.stderr)}`);
  }
  return ended.stdout;
}

export async function gitSucceeded(context: ScriptContext, folder: string, call: GitCall): Promise<string> {
  return succeededOutput(await git(context, folder, call), call[0]);
}

export function nulFields(output: string): readonly string[] {
  return output.split("\0").filter((field) => field !== "");
}

type Peeled = { readonly commit: string; readonly to: "commit" | "tree" };

async function objectOf(context: ScriptContext, folder: string, peeled: Peeled): Promise<string> {
  const ended = await git(context, folder, ["commit-of", `${peeled.commit}^{${peeled.to}}`]);
  if (ended.exitCode !== 0) {
    return fail(`There is no commit ${peeled.commit} in the repository.`);
  }
  return ended.stdout.trim();
}

export function commitOf(context: ScriptContext, folder: string, commit: string): Promise<string> {
  return objectOf(context, folder, { commit, to: "commit" });
}

export function treeOf(context: ScriptContext, folder: string, commit: string): Promise<string> {
  return objectOf(context, folder, { commit, to: "tree" });
}

export async function isMerged(context: ScriptContext, branch: string, into: string): Promise<boolean> {
  const ended = await git(context, ".", ["is-ancestor", branch, into]);
  if (ended.exitCode !== 0 && ended.exitCode !== 1) {
    fail(`git merge-base failed: ${firstLine(ended.stderr)}`);
  }
  return ended.exitCode === 0;
}

export async function branchExists(context: ScriptContext, branch: string): Promise<boolean> {
  const ended = await git(context, ".", ["commit-of", `refs/heads/${branch}`]);
  return ended.exitCode === 0;
}

const repositoryScopes: readonly string[] = ["local", "worktree"];

export async function refuseRepositoryFilters(context: ScriptContext, folder: string): Promise<void> {
  const ended = await git(context, folder, ["repository-filters"]);
  if (ended.exitCode !== 0 && ended.exitCode !== 1) {
    fail(`git config failed: ${firstLine(ended.stderr)}`);
  }
  const named = ended.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([scope]) => repositoryScopes.includes(scope ?? ""))
    .map(([, key]) => key ?? "");
  if (named.length > 0) {
    fail(
      `The repository's own configuration names ${named.join(", ")}. ` +
        "git could run the command of such a filter or merge driver, so the mode does nothing in this repository " +
        "until it is removed.",
    );
  }
}

export async function safeCommitOf(context: ScriptContext, folder: string, commit: string): Promise<string> {
  await refuseRepositoryFilters(context, folder);
  return commitOf(context, folder, commit);
}
