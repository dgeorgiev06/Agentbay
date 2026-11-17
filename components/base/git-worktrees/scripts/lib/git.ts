import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";

const protections: readonly string[] = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "submodule.recurse=false",
];

const emptyAttributes: readonly string[] = ["--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904"];

const committer: readonly string[] = [
  "-c",
  "user.name=agentbay-git-worktrees",
  "-c",
  "user.email=git-worktrees@agentbay.invalid",
  "-c",
  "gc.auto=0",
];

const makesCommits: readonly string[] = ["merge", "commit"];

const timeLimitSeconds = 300;

export type GitEnd = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

const changesTheCheckout: readonly string[] = ["restore", "switch", "merge", "add", "commit", "apply"];

function subcommandOf(gitArguments: readonly string[]): string {
  return gitArguments.find((argument) => !argument.startsWith("-")) ?? "";
}

function isUnderForge(folder: string): boolean {
  return folder.startsWith(".forge/") && !folder.split("/").includes("..");
}

function refuseInOwnersCheckout(folder: string, subcommand: string): void {
  if (changesTheCheckout.includes(subcommand) && !isUnderForge(folder)) {
    fail(
      `The mode runs git ${subcommand} only in a folder under .forge/, not in ${folder}, ` +
        "so that the owner's checkout is never changed.",
    );
  }
}

function optionsFor(subcommand: string): readonly string[] {
  return [...protections, ...emptyAttributes, ...(makesCommits.includes(subcommand) ? committer : [])];
}

export type Fed = {
  readonly gitArguments: readonly string[];
  readonly input: string;
};

async function ran(
  context: ScriptContext,
  folder: string,
  given: { readonly gitArguments: readonly string[]; readonly input?: string },
): Promise<GitEnd> {
  const { gitArguments, input } = given;
  const subcommand = subcommandOf(gitArguments);
  refuseInOwnersCheckout(folder, subcommand);
  const command = ["git", ...optionsFor(subcommand), ...gitArguments];
  const request = { command, folder, timeLimitSeconds };
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

export function git(context: ScriptContext, folder: string, gitArguments: readonly string[]): Promise<GitEnd> {
  return ran(context, folder, { gitArguments });
}

export function gitFed(context: ScriptContext, folder: string, fed: Fed): Promise<GitEnd> {
  return ran(context, folder, fed);
}

export function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "") ?? "it gave no reason";
}

export function succeededOutput(ended: GitEnd, gitArguments: readonly string[]): string {
  if (ended.exitCode !== 0) {
    return fail(`git ${subcommandOf(gitArguments)} failed: ${firstLine(ended.stderr)}`);
  }
  return ended.stdout;
}

export async function gitSucceeded(
  context: ScriptContext,
  folder: string,
  gitArguments: readonly string[],
): Promise<string> {
  return succeededOutput(await git(context, folder, gitArguments), gitArguments);
}

export function nulFields(output: string): readonly string[] {
  return output.split("\0").filter((field) => field !== "");
}

export async function commitOf(context: ScriptContext, folder: string, commit: string): Promise<string> {
  const ended = await git(context, folder, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${commit}^{commit}`,
  ]);
  if (ended.exitCode !== 0) {
    return fail(`There is no commit ${commit} in the repository.`);
  }
  return ended.stdout.trim();
}

export async function isMerged(context: ScriptContext, branch: string, into: string): Promise<boolean> {
  const ended = await git(context, ".", ["merge-base", "--is-ancestor", "--end-of-options", branch, into]);
  if (ended.exitCode !== 0 && ended.exitCode !== 1) {
    fail(`git merge-base failed: ${firstLine(ended.stderr)}`);
  }
  return ended.exitCode === 0;
}

export async function branchExists(context: ScriptContext, branch: string): Promise<boolean> {
  const ended = await git(context, ".", [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `refs/heads/${branch}`,
  ]);
  return ended.exitCode === 0;
}

const repositoryScopes: readonly string[] = ["local", "worktree"];

async function refuseRepositoryFilters(context: ScriptContext, folder: string): Promise<void> {
  const ended = await git(context, folder, [
    "config",
    "--show-scope",
    "--name-only",
    "--get-regexp",
    "^(filter\\.|merge\\..*\\.driver$)",
  ]);
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
