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

const everyEffect = "read, write, network, spend, delete";

function listedAt(line: number, name: string, run: string): readonly unknown[] {
  return [
    "warning",
    line,
    `Mode git-worktrees lists the command ${name}, which runs ${run} and which the mode says has the effects: ` +
      `${everyEffect}; a listed command can run code the agent wrote.`,
  ];
}

const unattributed = "git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c submodule.recurse=false";

const git = `${unattributed} --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904`;

const committing = `${git} -c user.name=agentbay-git-worktrees -c user.email=git-worktrees@agentbay.invalid -c gc.auto=0`;

test("bay check on the kit warns once for each command the git-worktrees mode lists, and for nothing else", () => {
  assert.deepEqual(warningsOf(manifest), [
    listedAt(13, "commit-of", `${git} rev-parse --verify --quiet --end-of-options`),
    listedAt(
      16,
      "repository-filters",
      `${git} config --show-scope --name-only --get-regexp ^(filter\\.|merge\\..*\\.driver$)`,
    ),
    listedAt(19, "add-detached-worktree", `${git} worktree add --detach --end-of-options`),
    listedAt(22, "make-branch", `${git} branch --end-of-options`),
    listedAt(25, "switch-branch", `${git} switch --end-of-options`),
    listedAt(28, "changes", `${git} status --porcelain=v1 -z --untracked-files=all --ignore-submodules=all --`),
    listedAt(
      31,
      "commits-between",
      `${git} log -z --reverse --no-show-signature --no-color --format=%H%x20%s --end-of-options`,
    ),
    listedAt(
      34,
      "changed-paths",
      `${git} diff --name-status -z -M --no-ext-diff --no-textconv --no-color --no-relative --end-of-options`,
    ),
    listedAt(37, "is-ignored", `${git} check-ignore --quiet --end-of-options`),
    listedAt(40, "paths-at-commit", `${git} ls-tree -z --name-only --end-of-options`),
    listedAt(43, "untracked-paths", `${git} ls-files -z --others --directory --end-of-options`),
    listedAt(46, "restore-paths", `${git} --work-tree=. restore --worktree --source`),
    listedAt(49, "is-ancestor", `${git} merge-base --is-ancestor --end-of-options`),
    listedAt(52, "remove-worktree", `${git} worktree remove --end-of-options`),
    listedAt(55, "delete-branch", `${git} branch -d --end-of-options`),
    listedAt(58, "add-worktree", `${git} worktree add --end-of-options`),
    listedAt(
      61,
      "merge-branch",
      `${committing} merge --no-ff --no-edit --no-stat --no-verify --no-gpg-sign --no-verify-signatures ` +
        "--no-autostash --no-rerere-autoupdate --end-of-options",
    ),
    listedAt(64, "abort-merge", `${committing} merge --abort`),
    listedAt(67, "stage-everything", `${git} add --all --`),
    listedAt(70, "commit-staged", `${committing} commit --quiet --no-verify --no-gpg-sign --file=- --end-of-options`),
    listedAt(73, "filters-of-paths", `${unattributed} --work-tree=. check-attr -z filter --`),
    listedAt(76, "apply-patch", `${unattributed} --work-tree=. apply --end-of-options`),
  ]);
});
