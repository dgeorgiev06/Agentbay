import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";

const protections: readonly string[] = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "submodule.recurse=false",
  "--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904",
];

const timeLimitSeconds = 300;

export type GitEnd = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

function subcommandOf(gitArguments: readonly string[]): string {
  return gitArguments.find((argument) => !argument.startsWith("-")) ?? "";
}

export async function git(context: ScriptContext, folder: string, gitArguments: readonly string[]): Promise<GitEnd> {
  const command = ["git", ...protections, ...gitArguments];
  const answer = await context.commands.run({ command, folder, timeLimitSeconds });
  if (!answer.ok) {
    return fail(answer.message);
  }
  const { end, stdout, stderr } = answer.value;
  const named = `git ${subcommandOf(gitArguments)}`;
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

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "") ?? "it gave no reason";
}

export async function gitSucceeded(
  context: ScriptContext,
  folder: string,
  gitArguments: readonly string[],
): Promise<string> {
  const ended = await git(context, folder, gitArguments);
  if (ended.exitCode !== 0) {
    return fail(`git ${subcommandOf(gitArguments)} failed: ${firstLine(ended.stderr)}`);
  }
  return ended.stdout;
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
  const ended = await git(context, folder, ["config", "--show-scope", "--name-only", "--get-regexp", "^filter\\."]);
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
        "git could run such a filter's command, so the mode does nothing in this repository until it is removed.",
    );
  }
}

export async function safeCommitOf(context: ScriptContext, folder: string, commit: string): Promise<string> {
  await refuseRepositoryFilters(context, folder);
  return commitOf(context, folder, commit);
}
