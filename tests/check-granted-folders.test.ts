import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { makeProject, type Project } from "./project-fixture.ts";

function ran(project: Project, words: readonly string[]): { readonly status: number | null; readonly output: string } {
  const result = spawnSync(process.execPath, [project.cli, ...words], {
    cwd: project.root,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    input: "",
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const refusal = /the step agentbay-writer-draft is granted \S+\/out\/notes, which holds \S+\/out\/notes\/\.env/;

test("bay check reports, as an error, the granted folder that holds a secret file the build refuses", async () => {
  const project = await makeProject({ adapter: "claude-code" });
  try {
    await project.write("out/notes/.env", "TOKEN=1\n");
    const checked = ran(project, ["check"]);
    assert.match(checked.output, refusal);
    assert.match(checked.output, /bay check: 1 error/);
    const built = ran(project, ["build"]);
    assert.notEqual(built.status, 0);
    assert.match(built.output, refusal);
  } finally {
    await project.remove();
  }
});

test("bay check finds nothing to report and bay build passes once the granted folder holds no such file", async () => {
  const project = await makeProject({ adapter: "claude-code" });
  try {
    await project.write("out/notes/kept.md", "a note\n");
    assert.doesNotMatch(ran(project, ["check"]).output, /is granted/);
    assert.equal(ran(project, ["build"]).status, 0);
  } finally {
    await project.remove();
  }
});

function pointerTo(project: Project, name: string): string {
  return `gitdir: ${join(project.root, ".git", "worktrees", name)}\n`;
}

test("bay check finds nothing to report and bay build passes while a git worktree's pointer sits in the granted folder", async () => {
  const project = await makeProject({ adapter: "claude-code" });
  try {
    await project.write("out/notes/wt/.git", pointerTo(project, "wt"));
    await project.write("out/notes/wt/src/a.ts", "export {};\n");
    assert.doesNotMatch(ran(project, ["check"]).output, /is granted/);
    assert.equal(ran(project, ["build"]).status, 0);
  } finally {
    await project.remove();
  }
});

type Placed = (project: Project) => Promise<void>;

const notPointers: readonly (readonly [string, Placed])[] = [
  ["a .git folder", (project) => project.write("out/notes/wt/.git/HEAD", "ref: refs/heads/main\n")],
  [
    "a .git link to a pointer",
    async (project) => {
      await project.write("out/notes/pointer", pointerTo(project, "wt"));
      await mkdir(join(project.root, "out", "notes", "wt"), { recursive: true });
      await symlink(join(project.root, "out", "notes", "pointer"), join(project.root, "out", "notes", "wt", ".git"));
    },
  ],
  ["a .git file with other text", (project) => project.write("out/notes/wt/.git", `${pointerTo(project, "wt")}x\n`)],
  [
    "a pointer outside the project's worktrees",
    (project) => project.write("out/notes/wt/.git", "gitdir: /tmp/.git/worktrees/wt\n"),
  ],
];

for (const [what, placed] of notPointers) {
  test(`bay check and bay build both refuse, in one sentence, a granted folder that holds ${what}`, async () => {
    const project = await makeProject({ adapter: "claude-code" });
    try {
      await placed(project);
      const granted = join(project.root, "out", "notes");
      const sentence = `the step agentbay-writer-draft is granted ${granted}, which holds ${join(granted, "wt", ".git")}`;
      const checked = ran(project, ["check"]);
      assert.ok(checked.output.includes(sentence), checked.output);
      assert.match(checked.output, /bay check: 1 error/);
      const built = ran(project, ["build"]);
      assert.notEqual(built.status, 0);
      assert.ok(built.output.includes(sentence), built.output);
    } finally {
      await project.remove();
    }
  });
}

function git(folder: string, words: readonly string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", ...words], {
    cwd: folder,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    stdio: "ignore",
  });
}

function refusedFor(project: Project, holds: string): string {
  const granted = join(project.root, "out", "notes");
  return `the step agentbay-writer-draft is granted ${granted}, which holds ${join(granted, "wt", holds)}`;
}

test("a real worktree of the project passes with its tracked CLAUDE.md, and refuses an untracked secret, a copy swapped for a link, or a tracked link", async () => {
  const project = await makeProject({ adapter: "claude-code" });
  const worktree = join(project.root, "out", "notes", "wt");
  try {
    await project.write("CLAUDE.md", "the project's notes\n");
    git(project.root, ["init", "--quiet"]);
    git(project.root, ["add", "CLAUDE.md"]);
    git(project.root, ["commit", "--quiet", "--no-gpg-sign", "--message", "base"]);
    git(project.root, ["worktree", "add", "--quiet", "--detach", worktree, "HEAD"]);
    assert.doesNotMatch(ran(project, ["check"]).output, /is granted/);
    assert.equal(ran(project, ["build"]).status, 0);
    assert.equal(ran(project, ["build", "--clean"]).status, 0);
    await project.write("out/notes/wt/.env.local", "");
    assert.ok(ran(project, ["check"]).output.includes(refusedFor(project, ".env.local")));
    assert.ok(ran(project, ["build"]).output.includes(refusedFor(project, ".env.local")));
    await rm(join(worktree, ".env.local"));
    await rm(join(worktree, "CLAUDE.md"));
    await symlink(join(project.root, "CLAUDE.md"), join(worktree, "CLAUDE.md"));
    assert.ok(ran(project, ["check"]).output.includes(refusedFor(project, "CLAUDE.md")));
    await rm(join(worktree, "CLAUDE.md"));
    git(worktree, ["checkout", "--", "CLAUDE.md"]);
    await mkdir(join(worktree, "docs"));
    await symlink("../CLAUDE.md", join(worktree, "docs", "CLAUDE.md"));
    git(worktree, ["add", "docs/CLAUDE.md"]);
    const linked = refusedFor(project, join("docs", "CLAUDE.md"));
    assert.ok(ran(project, ["check"]).output.includes(linked));
    assert.ok(ran(project, ["build"]).output.includes(linked));
  } finally {
    await project.remove();
  }
});
