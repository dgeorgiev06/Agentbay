import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const manifest = "components/base/git-worktrees/mode.yaml";

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function warningsOf(file: string): readonly (readonly unknown[])[] {
  const result = spawnSync(process.execPath, [join(kit, "bay", "cli.ts"), "check", "--json"], {
    cwd: kit,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    input: "",
    encoding: "utf8",
  });
  const findings: unknown = fieldOf(JSON.parse(result.stdout), "findings");
  const listed: readonly unknown[] = Array.isArray(findings) ? findings : [];
  return listed
    .filter((finding) => fieldOf(finding, "file") === file)
    .map((finding) => [fieldOf(finding, "severity"), fieldOf(finding, "line"), fieldOf(finding, "message")]);
}

type Listed = {
  readonly line: number;
  readonly name: string;
  readonly run: string;
  readonly effects: string;
};

function listedAt(listed: Listed): readonly unknown[] {
  return [
    "warning",
    listed.line,
    `Mode git-worktrees lists the command ${listed.name}, which runs ${listed.run} and which the mode says has ` +
      `the effects: ${listed.effects}; a listed command can run code the agent wrote.`,
  ];
}

const unattributed = "git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c submodule.recurse=false";

const git = `${unattributed} --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904`;

const committing = `${git} -c user.name=agentbay-git-worktrees -c user.email=git-worktrees@agentbay.invalid -c gc.auto=0`;

test("bay check on the kit warns once for each command the git-worktrees mode lists, and for nothing else", () => {
  assert.deepEqual(warningsOf(manifest), [
    listedAt({
      line: 14,
      name: "commit-of",
      effects: "read",
      run: `${git} rev-parse --verify --quiet --end-of-options`,
    }),
    listedAt({
      line: 17,
      name: "repository-filters",
      effects: "read",
      run: `${git} config --show-scope --name-only --get-regexp ^(filter\\.|merge\\..*\\.driver$)`,
    }),
    listedAt({
      line: 20,
      name: "add-detached-worktree",
      effects: "read, write",
      run: `${git} worktree add --detach --end-of-options`,
    }),
    listedAt({ line: 23, name: "make-branch", effects: "read, write", run: `${git} branch --end-of-options` }),
    listedAt({
      line: 26,
      name: "switch-branch",
      effects: "read, write, delete",
      run: `${git} switch --end-of-options`,
    }),
    listedAt({
      line: 29,
      name: "changes",
      effects: "read",
      run: `${git} --no-optional-locks status --porcelain=v1 -z --untracked-files=all --ignore-submodules=all --`,
    }),
    listedAt({
      line: 32,
      name: "commits-between",
      effects: "read",
      run: `${git} log -z --reverse --no-show-signature --no-color --format=%H%x20%s --end-of-options`,
    }),
    listedAt({
      line: 35,
      name: "changed-paths",
      effects: "read",
      run: `${git} diff-tree -r --name-status -z -M --no-ext-diff --no-textconv --no-color --no-relative --end-of-options`,
    }),
    listedAt({ line: 38, name: "is-ignored", effects: "read", run: `${git} check-ignore --quiet --end-of-options` }),
    listedAt({
      line: 41,
      name: "paths-at-commit",
      effects: "read",
      run: `${git} ls-tree -z --name-only --end-of-options`,
    }),
    listedAt({
      line: 44,
      name: "untracked-paths",
      effects: "read",
      run: `${git} ls-files -z --others --directory --end-of-options`,
    }),
    listedAt({
      line: 47,
      name: "restore-paths",
      effects: "read, write, network, spend, delete",
      run: `${git} -c core.autocrlf=false --git-dir=../../../.git --work-tree=. restore --worktree --source`,
    }),
    listedAt({
      line: 50,
      name: "is-ancestor",
      effects: "read",
      run: `${git} merge-base --is-ancestor --end-of-options`,
    }),
    listedAt({
      line: 53,
      name: "remove-worktree",
      effects: "read, write, delete",
      run: `${git} worktree remove --end-of-options`,
    }),
    listedAt({
      line: 56,
      name: "delete-branch",
      effects: "read, write, delete",
      run: `${git} branch -d --end-of-options`,
    }),
    listedAt({ line: 59, name: "add-worktree", effects: "read, write", run: `${git} worktree add --end-of-options` }),
    listedAt({
      line: 62,
      name: "merge-branch",
      effects: "read, write, delete",
      run:
        `${committing} merge --no-ff --no-edit --no-stat --no-verify --no-gpg-sign --no-verify-signatures ` +
        "--no-autostash --no-rerere-autoupdate --end-of-options",
    }),
    listedAt({ line: 65, name: "abort-merge", effects: "read, write, delete", run: `${committing} merge --abort` }),
    listedAt({ line: 68, name: "stage-everything", effects: "read, write, delete", run: `${git} add --all --` }),
    listedAt({
      line: 71,
      name: "commit-staged",
      effects: "read, write, delete",
      run: `${committing} commit --quiet --allow-empty --no-verify --no-gpg-sign --file=- --end-of-options`,
    }),
    listedAt({
      line: 74,
      name: "filters-of-paths",
      effects: "read",
      run: `${unattributed} --work-tree=. check-attr -z filter --`,
    }),
    listedAt({
      line: 77,
      name: "apply-patch",
      effects: "read, write, delete",
      run: `${unattributed} --work-tree=. apply --end-of-options`,
    }),
    listedAt({
      line: 80,
      name: "make-repository",
      effects: "read, write",
      run: `${git} init --quiet --template= --initial-branch=copy --end-of-options`,
    }),
    listedAt({
      line: 83,
      name: "repository-top",
      effects: "read",
      run: `${git} rev-parse --show-prefix --absolute-git-dir --show-toplevel`,
    }),
    listedAt({
      line: 86,
      name: "forget-paths",
      effects: "read, write, delete",
      run: `${git} --work-tree=. rm --cached -r --quiet --ignore-unmatch --`,
    }),
    listedAt({
      line: 89,
      name: "stage-paths",
      effects: "read, write, delete",
      run: `${git} --work-tree=. add --all --force --`,
    }),
  ]);
});

const protections: Readonly<Record<string, string>> = {
  "core.hooksPath": "/dev/null",
  "core.fsmonitor": "false",
  "submodule.recurse": "false",
};

const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const crashWithAttributeSource = new Set(["filters-of-paths", "apply-patch"]);

type GitStart = {
  readonly settings: ReadonlyMap<string, string>;
  readonly options: ReadonlyMap<string, string>;
};

function keyAndValue(text: string): readonly [string, string] {
  const equals = text.indexOf("=");
  return equals === -1 ? [text, ""] : [text.slice(0, equals), text.slice(equals + 1)];
}

function gitStartOf(words: readonly string[]): GitStart {
  const settings = new Map<string, string>();
  const options = new Map<string, string>();
  let index = 1;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (word === "-c") {
      settings.set(...keyAndValue(words[index + 1] ?? ""));
      index += 2;
    } else if (word.startsWith("-")) {
      options.set(...keyAndValue(word));
      index += 1;
    } else {
      break;
    }
  }
  return { settings, options };
}

function missingProtections(name: string, words: readonly string[]): readonly string[] {
  const start = gitStartOf(words);
  const program = words[0] === "git" ? [] : ["git as the program"];
  const settings = Object.entries(protections)
    .filter(([key, value]) => start.settings.get(key) !== value)
    .map(([key, value]) => `-c ${key}=${value}`);
  const attributes =
    crashWithAttributeSource.has(name) || start.options.get("--attr-source") === emptyTree
      ? []
      : [`--attr-source=${emptyTree}`];
  return [...program, ...settings, ...attributes];
}

const everyCommand = [
  "commit-of",
  "repository-filters",
  "add-detached-worktree",
  "make-branch",
  "switch-branch",
  "changes",
  "commits-between",
  "changed-paths",
  "is-ignored",
  "paths-at-commit",
  "untracked-paths",
  "restore-paths",
  "is-ancestor",
  "remove-worktree",
  "delete-branch",
  "add-worktree",
  "merge-branch",
  "abort-merge",
  "stage-everything",
  "commit-staged",
  "filters-of-paths",
  "apply-patch",
  "make-repository",
  "repository-top",
  "forget-paths",
  "stage-paths",
];

const ranWords =
  /^Mode git-worktrees lists the command (\S+), which runs (.*) and which the mode says has the effects: /;

test("every command the git-worktrees mode lists runs git with hooks, the file watcher and submodules off, and attributes from the empty tree wherever git accepts it", () => {
  const checked = warningsOf(manifest).map((warning) => {
    const match = ranWords.exec(String(warning[2]));
    const name = match?.[1] ?? String(warning[2]);
    return { name, lacks: missingProtections(name, (match?.[2] ?? "").split(" ")) };
  });
  assert.deepEqual(
    checked.filter((command) => command.lacks.length > 0),
    [],
  );
  assert.deepEqual(
    everyCommand.filter((name) => !checked.some((command) => command.name === name)),
    [],
  );
});
