import assert from "node:assert/strict";
import { lstat, mkdir, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { ModeProject, TestProject } from "../../../../../tests/test-toolbox.ts";

export type Files = Readonly<Record<string, string>>;

export type Place = { readonly folder: string } | { readonly branch: string };

export type Change = {
  readonly on: Place;
  readonly files: Files;
  readonly deleted: readonly string[];
  readonly message: string;
};

export type Start = TestProject & {
  readonly branch: string;
  readonly files: Files;
  readonly ignored: readonly string[];
};

export type Repository = {
  readonly project: ModeProject;
  readonly base: string;
  readonly commit: (change: Change) => Promise<string>;
  readonly makeBranch: (branch: string, commit: string) => Promise<void>;
  readonly headOf: (branch: string) => Promise<string | undefined>;
  readonly parentsOf: (commit: string) => Promise<readonly string[]>;
  readonly filesOf: (commit: string) => Promise<Files>;
  readonly checkedOut: () => Promise<string>;
  readonly listed: (folder: string) => Promise<readonly string[]>;
};

export type WorktreesUnderTest = {
  readonly mode: string;
  readonly ownData: readonly string[];
  readonly start: (start: Start) => Promise<Repository>;
};

type Value = Awaited<ReturnType<ModeProject["output"]>>;

type Fields = { readonly [key: string]: Value };

type Tree = {
  readonly files: Files;
  readonly links: Files;
};

type World = Repository & {
  readonly root: string;
  readonly ownData: readonly string[];
  readonly output: (action: string, input: Value) => Promise<Value>;
  readonly failure: (action: string, input: Value) => Promise<string>;
  readonly refusal: (action: string, input: Value) => Promise<string>;
  readonly attempt: (action: string, input: Value) => Promise<unknown>;
};

type Case = {
  readonly name: string;
  readonly restsOn: string;
  readonly run: (world: World) => Promise<void>;
};

const interfaceName = "worktrees";

const ownersBranch = "main";

const startFiles: Files = { "README.md": "A small repository.\n", "src/main.txt": "main\n" };

const ignoredPaths: readonly string[] = ["deps", "run.log"];

const kernelData = ".agentbay";

const forgeData = ".forge";

const moved = "A file long enough that a move is seen as a move rather than a new file.\n".repeat(4);

const changeKeptAddDeleteGone = [
  "diff --git a/kept.txt b/kept.txt",
  "--- a/kept.txt",
  "+++ b/kept.txt",
  "@@ -1,2 +1,2 @@",
  " one",
  "-two",
  "+three",
  "diff --git a/dir/new.txt b/dir/new.txt",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/dir/new.txt",
  "@@ -0,0 +1 @@",
  "+new",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-gone",
  "",
].join("\n");

const changeKeptThenFailOnOther = [
  "diff --git a/kept.txt b/kept.txt",
  "--- a/kept.txt",
  "+++ b/kept.txt",
  "@@ -1,2 +1,2 @@",
  " one",
  "-two",
  "+three",
  "diff --git a/other.txt b/other.txt",
  "--- a/other.txt",
  "+++ b/other.txt",
  "@@ -1 +1 @@",
  "-not what the file holds",
  "+changed",
  "",
].join("\n");

function isFields(value: Value): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: Value | undefined): value is readonly Value[] {
  return Array.isArray(value);
}

function listOf(value: Value | undefined): readonly Value[] {
  assert.ok(isList(value), JSON.stringify(value));
  return value;
}

function fieldsOf(value: Value): Fields {
  assert.ok(isFields(value), JSON.stringify(value));
  return value;
}

function textOf(value: Value | undefined): string {
  assert.ok(typeof value === "string", JSON.stringify(value));
  return value;
}

const givenReason = "a reason is given";

function sentenceOf(reason: string): string {
  assert.notEqual(reason.trim(), "");
  return givenReason;
}

function changeOn(on: Place, files: Files, message: string): Change {
  return { on, files, deleted: [], message };
}

function without(files: Files, paths: readonly string[]): Files {
  return Object.fromEntries(Object.entries(files).filter(([path]) => !paths.includes(path)));
}

function under(files: Files, folder: string): Files {
  return without(
    files,
    Object.keys(files).filter((path) => path.startsWith(`${folder}/`)),
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(top: string, skipped: readonly string[]): Promise<Tree> {
  const files: Record<string, string> = {};
  const links: Record<string, string> = {};
  const visit = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(top, relative), { withFileTypes: true })) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (relative === "" && skipped.includes(entry.name)) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        links[path] = await readlink(join(top, path));
      } else if (entry.isDirectory()) {
        await visit(path);
      } else {
        files[path] = await readFile(join(top, path), "utf8");
      }
    }
  };
  if (await exists(top)) {
    await visit("");
  }
  return { files, links };
}

function treeIn(world: World, folder: string): Promise<Tree> {
  return walk(join(world.root, folder), world.ownData);
}

async function filesIn(world: World, folder: string): Promise<Files> {
  return (await treeIn(world, folder)).files;
}

function forgeTree(world: World): Promise<Tree> {
  return walk(join(world.root, forgeData), []);
}

async function written(world: World, folder: string, files: Files): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const file = join(world.root, folder, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }
}

async function erased(world: World, folder: string, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    await rm(join(world.root, folder, path), { recursive: true, force: true });
  }
}

type OwnersCheckout = {
  readonly branch: string;
  readonly head: string | undefined;
  readonly files: Files;
};

async function ownersCheckout(world: World): Promise<OwnersCheckout> {
  const branch = await world.checkedOut();
  const skipped = [...world.ownData, kernelData, forgeData];
  return { branch, head: await world.headOf(branch), files: (await walk(world.root, skipped)).files };
}

async function cut(world: World, slice: string): Promise<string> {
  return textOf(fieldsOf(await world.output("cut", { slice, base: ownersBranch })).folder);
}

async function copied(world: World, input: Fields): Promise<string> {
  return textOf(fieldsOf(await world.output("copy", input)).folder);
}

async function sliceWithCommit(
  world: World,
  files: Files,
): Promise<{ readonly folder: string; readonly head: string }> {
  const folder = await cut(world, "feature");
  const head = await world.commit(changeOn({ folder }, files, "Do the feature"));
  return { folder, head };
}

async function targetWith(world: World, files: Files): Promise<string> {
  await world.makeBranch("integration", world.base);
  return world.commit(changeOn({ branch: "integration" }, files, "Change integration"));
}

async function statusOf(world: World, folder: string): Promise<Value> {
  return world.output("status", { folder, base: world.base });
}

function clean(head: string): Fields {
  return { head, commits: [], clean: true, changed: [], untracked: [] };
}

function shownStatus(value: Value): Fields {
  const fields = fieldsOf(value);
  const sorted = (name: string): Value => listOf(fields[name]).map(textOf).sort();
  return { ...fields, changed: sorted("changed"), untracked: sorted("untracked") };
}

function shownChanges(value: Value): readonly Value[] {
  return [...listOf(fieldsOf(value).paths)].sort((left, right) =>
    textOf(fieldsOf(left).path).localeCompare(textOf(fieldsOf(right).path)),
  );
}

async function copyToPatch(world: World, files: Files): Promise<{ readonly folder: string; readonly commit: string }> {
  await world.makeBranch("patched", world.base);
  const commit = await world.commit(changeOn({ branch: "patched" }, files, "Files to patch"));
  return { folder: await copied(world, { commit, name: "patched" }), commit };
}

async function twoCommits(world: World): Promise<{ readonly earlier: string; readonly later: string }> {
  await world.makeBranch("history", world.base);
  const earlier = await world.commit(
    changeOn({ branch: "history" }, { "kept.txt": "earlier\n", "dir/a.txt": "a\n" }, "The earlier commit"),
  );
  const later = await world.commit({
    on: { branch: "history" },
    files: { "kept.txt": "later\n", "dir/only-later.txt": "later\n", "new.txt": "new\n" },
    deleted: ["dir/a.txt"],
    message: "The later commit",
  });
  return { earlier, later };
}

const placeStatus = "status-request and status-response";

const cases: readonly Case[] = [
  {
    name: "cut makes the branch forge/<slice> and a worktree at the base commit in full, holding the commit's files, and status of it is clean with no commits",
    restsOn:
      "cut-request (slice: the branch is forge/ and the name; base: a commit or a branch name), cut-response, status-response",
    run: async (world) => {
      const output = fieldsOf(await world.output("cut", { slice: "first", base: ownersBranch }));
      const folder = textOf(output.folder);
      assert.deepEqual(output, { folder, branch: "forge/first", commit: world.base });
      assert.equal(await world.headOf("forge/first"), world.base);
      assert.deepEqual(await treeIn(world, folder), { files: await world.filesOf(world.base), links: {} });
      assert.deepEqual(await statusOf(world, folder), clean(world.base));
    },
  },
  {
    name: "a second cut of the same slice is refused, and its branch and worktree are as they were",
    restsOn: "cut-response (the worktree and branch that were made); README, cut: refused when the branch exists",
    run: async (world) => {
      const folder = await cut(world, "again");
      const head = await world.commit(changeOn({ folder }, { "work.txt": "work\n" }, "Do the work"));
      await written(world, folder, { "notes.txt": "Not committed.\n" });
      const before = await treeIn(world, folder);
      assert.equal(sentenceOf(await world.failure("cut", { slice: "again", base: ownersBranch })), givenReason);
      assert.equal(await world.headOf("forge/again"), head);
      assert.deepEqual(await treeIn(world, folder), before);
    },
  },
  {
    name: "a cut from a commit that does not exist is refused, and no branch is made",
    restsOn: "cut-request (base: the commit the slice starts from)",
    run: async (world) => {
      const before = await forgeTree(world);
      assert.equal(sentenceOf(await world.failure("cut", { slice: "lost", base: "no-such-branch" })), givenReason);
      assert.equal(await world.headOf("forge/lost"), undefined);
      assert.deepEqual(await forgeTree(world), before);
    },
  },
  {
    name: "a cut whose branch already exists is refused even when the slice has no worktree, and the branch is as it was",
    restsOn: "cut-response (the worktree and branch that were made); README, cut: refused when the branch exists",
    run: async (world) => {
      await world.makeBranch("history", world.base);
      const head = await world.commit(changeOn({ branch: "history" }, { "work.txt": "work\n" }, "Do the work"));
      await world.makeBranch("forge/taken", head);
      const before = await forgeTree(world);
      assert.equal(sentenceOf(await world.failure("cut", { slice: "taken", base: ownersBranch })), givenReason);
      assert.equal(await world.headOf("forge/taken"), head);
      assert.deepEqual(await forgeTree(world), before);
    },
  },
  {
    name: "status gives the worktree's head and the commits since the base, oldest first, with their subjects, and the commits are on the slice's branch",
    restsOn: placeStatus,
    run: async (world) => {
      const folder = await cut(world, "watched");
      const first = await world.commit(changeOn({ folder }, { "a.txt": "a\n" }, "Add the first file"));
      const second = await world.commit(changeOn({ folder }, { "b.txt": "b\n" }, "Add the second file"));
      assert.deepEqual(await statusOf(world, folder), {
        head: second,
        commits: [
          { hash: first, subject: "Add the first file" },
          { hash: second, subject: "Add the second file" },
        ],
        clean: true,
        changed: [],
        untracked: [],
      });
      assert.equal(await world.headOf("forge/watched"), second);
    },
  },
  {
    name: "status names changed and deleted paths and untracked files, never an ignored one, and the worktree is not clean",
    restsOn: placeStatus,
    run: async (world) => {
      const folder = await cut(world, "watched");
      await written(world, folder, {
        "README.md": "Changed by hand.\n",
        "notes/new.txt": "new\n",
        "run.log": "ignored\n",
        "deps/package.txt": "ignored\n",
      });
      await erased(world, folder, ["src/main.txt"]);
      assert.deepEqual(shownStatus(await statusOf(world, folder)), {
        head: world.base,
        commits: [],
        clean: false,
        changed: ["README.md", "src/main.txt"],
        untracked: ["notes/new.txt"],
      });
    },
  },
  {
    name: "changed lists exactly the paths that differ between two commits, each with how, and none for the same commit twice",
    restsOn: "changed-request and changed-response",
    run: async (world) => {
      await world.makeBranch("history", world.base);
      const from = await world.commit(
        changeOn(
          { branch: "history" },
          { "kept.txt": "first\n", "gone.txt": "soon gone\n", "old-name.txt": moved, "same.txt": "same\n" },
          "Add four files",
        ),
      );
      const to = await world.commit({
        on: { branch: "history" },
        files: { "kept.txt": "second\n", "added.txt": "new\n", "new-name.txt": moved },
        deleted: ["gone.txt", "old-name.txt"],
        message: "Change, remove, move and add",
      });
      assert.deepEqual(shownChanges(await world.output("changed", { from, to: "history" })), [
        { path: "added.txt", how: "added" },
        { path: "gone.txt", how: "deleted" },
        { path: "kept.txt", how: "modified" },
        { path: "new-name.txt", how: "renamed", from: "old-name.txt" },
      ]);
      assert.deepEqual(await world.output("changed", { from: to, to: "history" }), { paths: [] });
      assert.equal(sentenceOf(await world.failure("changed", { from, to: "nowhere" })), givenReason);
    },
  },
  {
    name: "a copy holds exactly the commit's files as they are at the commit, and none of the project's own data",
    restsOn: "copy-request (commit: the commit whose files the copy holds), copy-response",
    run: async (world) => {
      await world.makeBranch("history", world.base);
      const commit = await world.commit(
        changeOn({ branch: "history" }, { "src/main.txt": "at the commit\n" }, "Change main"),
      );
      await written(world, ".", { "README.md": "Changed after the commit.\n", "loose.txt": "not committed\n" });
      const folder = await copied(world, { commit: "history", name: "plain" });
      const tree = await treeIn(world, folder);
      assert.deepEqual(tree, { files: await world.filesOf(commit), links: {} });
      assert.equal(tree.files["src/main.txt"], "at the commit\n");
      assert.equal(tree.files["README.md"], "A small repository.\n");
    },
  },
  {
    name: "a linked path in a copy is a link to the project's own path; a path the repository does not ignore is refused and no copy is made",
    restsOn: "copy-request (links: links to the project's own; each must be ignored in the project)",
    run: async (world) => {
      await written(world, ".", { "deps/package/index.txt": "installed\n", "loose.txt": "not committed\n" });
      const folder = await copied(world, { commit: ownersBranch, name: "linked", links: ["deps"] });
      assert.deepEqual(await treeIn(world, folder), {
        files: await world.filesOf(world.base),
        links: { deps: join(world.root, "deps") },
      });
      assert.equal(await readFile(join(world.root, folder, "deps/package/index.txt"), "utf8"), "installed\n");
      const before = await forgeTree(world);
      const refused = { commit: ownersBranch, name: "refused", links: ["deps", "loose.txt"] };
      assert.equal(sentenceOf(await world.failure("copy", refused)), givenReason);
      assert.deepEqual(await forgeTree(world), before);
      const later = await copied(world, { commit: ownersBranch, name: "refused" });
      assert.deepEqual(await treeIn(world, later), { files: await world.filesOf(world.base), links: {} });
    },
  },
  {
    name: "a copy is a repository of its own: the mode's tool for listing files lists exactly the commit's files and not the links, and after an overlay exactly the files the copy then holds",
    restsOn:
      "copy-response (a repository of its own holding the commit's files; links present and ignored), overlay-response (the copy's files are listed as they now are)",
    run: async (world) => {
      const { earlier, later } = await twoCommits(world);
      await written(world, ".", { "deps/package.txt": "installed\n" });
      const folder = await copied(world, { commit: later, name: "listed", links: ["deps"] });
      const atLater = Object.keys(await world.filesOf(later)).sort();
      assert.deepEqual(await world.listed(folder), atLater);
      assert.deepEqual(
        ["deps", "new.txt", "dir/only-later.txt"].map((path) => atLater.includes(path)),
        [false, true, true],
      );
      await world.output("overlay", { folder, commit: earlier, paths: ["dir", "new.txt"] });
      const overlaid = Object.keys({
        ...without(under(await world.filesOf(later), "dir"), ["new.txt"]),
        "dir/a.txt": "",
      });
      assert.deepEqual(await world.listed(folder), overlaid.sort());
      assert.deepEqual(
        ["new.txt", "dir/only-later.txt", "dir/a.txt"].map((path) => overlaid.includes(path)),
        [false, false, true],
      );
    },
  },
  {
    name: "a commit made inside a copy stays in the copy: the project has no such commit, and its branches and files are as they were",
    restsOn: "copy-response (nothing done inside the copy changes the project's repository)",
    run: async (world) => {
      const folder = await copied(world, { commit: ownersBranch, name: "inside" });
      const owner = await ownersCheckout(world);
      const made = await world.commit(
        changeOn({ folder }, { "inside.txt": "made inside\n" }, "Commit inside the copy"),
      );
      assert.equal(sentenceOf(await world.failure("changed", { from: ownersBranch, to: made })), givenReason);
      assert.equal(sentenceOf(await world.failure("copy", { commit: made, name: "again" })), givenReason);
      assert.equal(await world.headOf(ownersBranch), world.base);
      assert.deepEqual(await ownersCheckout(world), owner);
      assert.equal((await world.listed(folder)).includes("inside.txt"), true);
    },
  },
  {
    name: "a copy name already in use is refused, and that copy is as it was",
    restsOn: "copy-request (name: the copy's name)",
    run: async (world) => {
      const folder = await copied(world, { commit: ownersBranch, name: "twice" });
      await written(world, folder, { "stray.txt": "made in the copy\n" });
      const before = await treeIn(world, folder);
      assert.equal(sentenceOf(await world.failure("copy", { commit: ownersBranch, name: "twice" })), givenReason);
      assert.deepEqual(await treeIn(world, folder), before);
    },
  },
  {
    name: "overlay puts named paths into a copy as they are at the commit, a folder whole, and removes a path absent there",
    restsOn: "overlay-request and overlay-response (placed: now as at the commit; removed: absent at the commit)",
    run: async (world) => {
      const { earlier, later } = await twoCommits(world);
      const folder = await copied(world, { commit: later, name: "later" });
      await written(world, folder, { "dir/stray.txt": "made in the copy\n" });
      const paths = ["kept.txt", "dir", "new.txt"];
      assert.deepEqual(await world.output("overlay", { folder, commit: earlier, paths }), {
        folder,
        placed: ["kept.txt", "dir"],
        removed: ["new.txt"],
      });
      const expected = {
        ...without(under(await world.filesOf(later), "dir"), ["new.txt"]),
        "kept.txt": "earlier\n",
        "dir/a.txt": "a\n",
      };
      assert.deepEqual(await treeIn(world, folder), { files: expected, links: {} });
    },
  },
  {
    name: "apply changes exactly the paths a patch names in the copy, and gives them in the patch's order",
    restsOn:
      "apply-request and apply-response (paths: each path the patch added, changed, deleted or renamed, in order)",
    run: async (world) => {
      const files = { "kept.txt": "one\ntwo\n", "gone.txt": "gone\n", "other.txt": "other\n" };
      const { folder, commit } = await copyToPatch(world, files);
      assert.deepEqual(await world.output("apply", { folder, patch: changeKeptAddDeleteGone }), {
        folder,
        paths: ["kept.txt", "dir/new.txt", "gone.txt"],
      });
      const expected = {
        ...without(await world.filesOf(commit), ["gone.txt"]),
        "kept.txt": "one\nthree\n",
        "dir/new.txt": "new\n",
      };
      assert.deepEqual(await treeIn(world, folder), { files: expected, links: {} });
    },
  },
  {
    name: "a removed line that starts with two dashes is content, not a path the patch names",
    restsOn: "apply-request (patch: as git diff writes it), apply-response (paths)",
    run: async (world) => {
      const { folder } = await copyToPatch(world, { "notes.sql": "-- old\n" });
      const patch =
        "diff --git a/notes.sql b/notes.sql\n--- a/notes.sql\n+++ b/notes.sql\n@@ -1 +1 @@\n--- old\n+-- new\n";
      assert.deepEqual(await world.output("apply", { folder, patch }), { folder, paths: ["notes.sql"] });
      assert.equal(await readFile(join(world.root, folder, "notes.sql"), "utf8"), "-- new\n");
    },
  },
  {
    name: "a patch that does not apply whole is refused and changes nothing in the copy",
    restsOn: "apply action (README: all of it or nothing)",
    run: async (world) => {
      const files = { "kept.txt": "one\ntwo\n", "other.txt": "other\n" };
      const { folder } = await copyToPatch(world, files);
      const before = await treeIn(world, folder);
      assert.equal(sentenceOf(await world.failure("apply", { folder, patch: changeKeptThenFailOnOther })), givenReason);
      assert.deepEqual(await treeIn(world, folder), before);
    },
  },
  {
    name: "a patch naming a path outside the copy, or beyond a link the copy holds, is refused and changes nothing anywhere",
    restsOn:
      "apply-request (patch: each path is relative to the copy and has no ..), copy-request (links are the project's own)",
    run: async (world) => {
      await written(world, ".", { "deps/package.txt": "installed\n" });
      const folder = await copied(world, { commit: ownersBranch, name: "patched", links: ["deps"] });
      const before = { copy: await treeIn(world, folder), forge: await forgeTree(world) };
      const owner = await ownersCheckout(world);
      const outside = join(world.root, "escaped.txt");
      const newFile = (path: string): string =>
        `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+x\n`;
      const patches = [newFile("../x"), `--- /dev/null\n+++ ${outside}\n@@ -0,0 +1 @@\n+x\n`, newFile("deps/evil.txt")];
      for (const patch of patches) {
        assert.equal(sentenceOf(await world.failure("apply", { folder, patch })), givenReason);
      }
      assert.deepEqual({ copy: await treeIn(world, folder), forge: await forgeTree(world) }, before);
      assert.deepEqual(await walk(join(world.root, "deps"), []), {
        files: { "package.txt": "installed\n" },
        links: {},
      });
      assert.equal(await exists(outside), false);
      assert.deepEqual(await ownersCheckout(world), owner);
    },
  },
  {
    name: "merge makes a merge commit on the target whose parents are the target's old head and the slice's head, and a second merge says it is already merged",
    restsOn:
      "merge-request and merge-response (merged: commit with two parents, landed on a branch not checked out; already-merged: the head, unchanged)",
    run: async (world) => {
      const { folder, head } = await sliceWithCommit(world, { "feature.txt": "feature\n" });
      const target = await targetWith(world, { "other.txt": "other\n" });
      const output = fieldsOf(await world.output("merge", { folder, into: "integration" }));
      const commit = await world.headOf("integration");
      assert.deepEqual(output, {
        how: "merged",
        branch: "forge/feature",
        into: "integration",
        commit: commit ?? null,
        landed: "branch-not-checked-out",
      });
      assert.deepEqual(await world.parentsOf(textOf(commit)), [target, head]);
      assert.deepEqual(await world.filesOf(textOf(commit)), {
        ...(await world.filesOf(target)),
        "feature.txt": "feature\n",
      });
      assert.equal(await world.headOf("forge/feature"), head);
      assert.deepEqual(await world.output("merge", { folder, into: "integration" }), {
        how: "already-merged",
        branch: "forge/feature",
        into: "integration",
        commit: commit ?? null,
      });
      assert.equal(await world.headOf("integration"), commit);
    },
  },
  {
    name: "a target with no commits of its own still gets a merge commit with two parents",
    restsOn: "merge-response (merged: the slice's branch was merged with a merge commit)",
    run: async (world) => {
      const { folder, head } = await sliceWithCommit(world, { "feature.txt": "feature\n" });
      await world.makeBranch("integration", world.base);
      const output = fieldsOf(await world.output("merge", { folder, into: "integration" }));
      const commit = textOf(output.commit);
      assert.equal(await world.headOf("integration"), commit);
      assert.deepEqual(await world.parentsOf(commit), [world.base, head]);
    },
  },
  {
    name: "a conflict is refused naming the conflicting path; the target, the slice's branch and its worktree are as they were, and the same merge can be tried again",
    restsOn: "merge-request (folder, into); README, merge: a conflict is undone and refused with the conflicting paths",
    run: async (world) => {
      const sliceFiles = { "README.md": "The slice's line.\n", "a.txt": "a\n" };
      const { folder, head } = await sliceWithCommit(world, sliceFiles);
      const target = await targetWith(world, { "README.md": "The target's line.\n" });
      const reason = await world.failure("merge", { folder, into: "integration" });
      assert.equal(reason.includes("README.md"), true, reason);
      assert.equal(await world.headOf("integration"), target);
      assert.equal(await world.headOf("forge/feature"), head);
      assert.deepEqual(await statusOf(world, folder), {
        head,
        commits: [{ hash: head, subject: "Do the feature" }],
        clean: true,
        changed: [],
        untracked: [],
      });
      assert.equal(await world.failure("merge", { folder, into: "integration" }), reason);
      const resolved = await world.commit(
        changeOn({ folder }, { "README.md": "The target's line.\n" }, "Take the target's line"),
      );
      const output = fieldsOf(await world.output("merge", { folder, into: "integration" }));
      assert.deepEqual(await world.parentsOf(textOf(output.commit)), [target, resolved]);
    },
  },
  {
    name: "merge into the branch the project's own folder has checked out fast-forwards it to a merge commit when the folder is clean; the folder holds the merge's files, the branch stays checked out, and an untracked file the merge does not touch is kept",
    restsOn:
      "merge-request (into: checked out only in the project's own folder), merge-response (landed: checked-out-branch-fast-forwarded)",
    run: async (world) => {
      const { folder, head } = await sliceWithCommit(world, { "feature.txt": "feature\n" });
      await written(world, ".", { "notes.txt": "Not committed.\n" });
      const before = await ownersCheckout(world);
      const output = fieldsOf(await world.output("merge", { folder, into: ownersBranch }));
      const commit = textOf(output.commit);
      assert.deepEqual(output, {
        how: "merged",
        branch: "forge/feature",
        into: ownersBranch,
        commit,
        landed: "checked-out-branch-fast-forwarded",
      });
      assert.deepEqual(await world.parentsOf(commit), [world.base, head]);
      assert.deepEqual(await world.filesOf(commit), {
        ...(await world.filesOf(world.base)),
        "feature.txt": "feature\n",
      });
      assert.deepEqual(await ownersCheckout(world), {
        branch: ownersBranch,
        head: commit,
        files: { ...before.files, "feature.txt": "feature\n" },
      });
      assert.deepEqual(await world.output("merge", { folder, into: ownersBranch }), {
        how: "already-merged",
        branch: "forge/feature",
        into: ownersBranch,
        commit,
      });
      assert.equal(fieldsOf(await world.output("remove", { folder, into: ownersBranch })).kind, "worktree");
    },
  },
  {
    name: "merge into the checked-out branch is refused while the project's folder has an uncommitted change or an untracked file where the merge puts one, and nothing changes anywhere; once they are gone it lands",
    restsOn:
      "merge-request (into: fast-forwarded only when the project's folder is clean); README, merge: what clean means",
    run: async (world) => {
      const { folder } = await sliceWithCommit(world, { "feature.txt": "feature\n" });
      const readme = { "README.md": "A small repository.\n" };
      const blockers: readonly Files[] = [
        { "README.md": "The owner's own change.\n" },
        { "feature.txt": "The owner's own file.\n" },
      ];
      for (const blocker of blockers) {
        await written(world, ".", blocker);
        const before = { owner: await ownersCheckout(world), forge: await forgeTree(world) };
        assert.equal(sentenceOf(await world.failure("merge", { folder, into: ownersBranch })), givenReason);
        assert.deepEqual({ owner: await ownersCheckout(world), forge: await forgeTree(world) }, before);
        assert.equal(await world.headOf(ownersBranch), world.base);
        await written(world, ".", readme);
        await erased(world, ".", ["feature.txt"]);
      }
      const output = fieldsOf(await world.output("merge", { folder, into: ownersBranch }));
      assert.equal(output.landed, "checked-out-branch-fast-forwarded");
      assert.equal(await world.headOf(ownersBranch), output.commit);
    },
  },
  {
    name: "a conflict with the checked-out branch is refused naming the path, and the branch, the project's folder and the slice are as they were",
    restsOn: "merge-request (folder, into); README, merge: a conflict is undone and refused with the conflicting paths",
    run: async (world) => {
      const { folder, head } = await sliceWithCommit(world, { "README.md": "The slice's line.\n" });
      const owners = await world.commit(
        changeOn({ branch: ownersBranch }, { "README.md": "The owner's line.\n" }, "Change main"),
      );
      const before = { owner: await ownersCheckout(world), forge: await forgeTree(world) };
      const reason = await world.failure("merge", { folder, into: ownersBranch });
      assert.equal(reason.includes("README.md"), true, reason);
      assert.deepEqual({ owner: await ownersCheckout(world), forge: await forgeTree(world) }, before);
      assert.equal(await world.headOf(ownersBranch), owners);
      assert.equal(await world.headOf("forge/feature"), head);
    },
  },
  {
    name: "merge refuses a worktree with a changed file, a target that does not exist and a branch checked out in another worktree, and changes no branch",
    restsOn:
      "merge-request (folder: no changed or untracked files; into: checked out nowhere, or only in the project's own folder)",
    run: async (world) => {
      const { folder, head } = await sliceWithCommit(world, { "feature.txt": "feature\n" });
      assert.equal(sentenceOf(await world.failure("merge", { folder, into: "integration" })), givenReason);
      assert.equal(await world.headOf("integration"), undefined);
      await cut(world, "elsewhere");
      assert.equal(sentenceOf(await world.failure("merge", { folder, into: "forge/elsewhere" })), givenReason);
      assert.equal(await world.headOf("forge/elsewhere"), world.base);
      const target = await targetWith(world, { "other.txt": "other\n" });
      await written(world, folder, { "feature.txt": "Not yet committed.\n" });
      assert.equal(sentenceOf(await world.failure("merge", { folder, into: "integration" })), givenReason);
      assert.equal(await world.headOf("integration"), target);
      assert.equal(await world.headOf("forge/feature"), head);
    },
  },
  {
    name: "set-aside commits every changed, deleted and untracked file to forge/wip/<slice>/1 on the worktree's head, and leaves the worktree clean with its ignored files",
    restsOn:
      "set-aside-request and set-aside-response (set-aside: commit's parent is the head; the worktree back at its head with no changes)",
    run: async (world) => {
      const folder = await cut(world, "feature");
      const head = world.base;
      await written(world, folder, {
        "README.md": "Changed in the slice.\n",
        "notes/new.txt": "new\n",
        "run.log": "ignored\n",
      });
      await erased(world, folder, ["src/main.txt"]);
      const output = await world.output("set-aside", { folder });
      const commit = await world.headOf("forge/wip/feature/1");
      assert.deepEqual(output, { how: "set-aside", folder, branch: "forge/wip/feature/1", commit: commit ?? null });
      assert.deepEqual(await world.parentsOf(textOf(commit)), [head]);
      assert.deepEqual(await world.filesOf(textOf(commit)), {
        ...without(await world.filesOf(head), ["src/main.txt"]),
        "README.md": "Changed in the slice.\n",
        "notes/new.txt": "new\n",
      });
      assert.deepEqual(await statusOf(world, folder), clean(head));
      assert.equal(await world.headOf("forge/feature"), head);
      assert.deepEqual(await filesIn(world, folder), { ...(await world.filesOf(head)), "run.log": "ignored\n" });
    },
  },
  {
    name: "set-aside never reuses a branch name: a taken number is skipped, and each earlier branch is as it was",
    restsOn: "set-aside-response (branch: forge/wip/<slice>/<n>, with n the next unused number)",
    run: async (world) => {
      const folder = await cut(world, "feature");
      await world.makeBranch("forge/wip/feature/1", world.base);
      await written(world, folder, { "first.txt": "first\n" });
      const first = fieldsOf(await world.output("set-aside", { folder }));
      assert.equal(first.branch, "forge/wip/feature/2");
      await written(world, folder, { "second.txt": "second\n" });
      const second = fieldsOf(await world.output("set-aside", { folder }));
      assert.equal(second.branch, "forge/wip/feature/3");
      assert.deepEqual(
        [
          await world.headOf("forge/wip/feature/1"),
          await world.headOf("forge/wip/feature/2"),
          await world.headOf("forge/wip/feature/3"),
        ],
        [world.base, textOf(first.commit), textOf(second.commit)],
      );
      assert.deepEqual(await world.filesOf(textOf(second.commit)), {
        ...(await world.filesOf(world.base)),
        "second.txt": "second\n",
      });
    },
  },
  {
    name: "set-aside with nothing but ignored files does nothing, makes no branch, and keeps the ignored files",
    restsOn: "set-aside-response (nothing-changed: no branch was made)",
    run: async (world) => {
      const folder = await cut(world, "feature");
      await written(world, folder, { "run.log": "ignored\n" });
      assert.deepEqual(await world.output("set-aside", { folder }), { how: "nothing-changed", folder });
      assert.equal(await world.headOf("forge/wip/feature/1"), undefined);
      assert.equal(await readFile(join(world.root, folder, "run.log"), "utf8"), "ignored\n");
    },
  },
  {
    name: "commit puts every changed, deleted and untracked file on the slice's own branch, one commit ahead with the message given, and the files stay in the worktree, which is clean, with its ignored files left out",
    restsOn:
      "commit-request and commit-response (committed: the commit's parent is the branch's head before, its message the one given; the files stay)",
    run: async (world) => {
      const folder = await cut(world, "feature");
      await written(world, folder, {
        "README.md": "Changed in the slice.\n",
        "notes/new.txt": "new\n",
        "run.log": "ignored\n",
      });
      await erased(world, folder, ["src/main.txt"]);
      const message = "Build the feature\n\nThe first round of the builder's work.";
      const output = await world.output("commit", { folder, message });
      const commit = await world.headOf("forge/feature");
      assert.deepEqual(output, { how: "committed", folder, branch: "forge/feature", commit: commit ?? null });
      assert.deepEqual(await world.parentsOf(textOf(commit)), [world.base]);
      const expected = {
        ...without(await world.filesOf(world.base), ["src/main.txt"]),
        "README.md": "Changed in the slice.\n",
        "notes/new.txt": "new\n",
      };
      assert.deepEqual(await world.filesOf(textOf(commit)), expected);
      assert.deepEqual(await statusOf(world, folder), {
        head: textOf(commit),
        commits: [{ hash: textOf(commit), subject: "Build the feature" }],
        clean: true,
        changed: [],
        untracked: [],
      });
      assert.deepEqual(await filesIn(world, folder), { ...expected, "run.log": "ignored\n" });
      assert.deepEqual([await world.checkedOut(), await world.headOf(ownersBranch)], [ownersBranch, world.base]);
    },
  },
  {
    name: "commit with one untracked file, then with one changed file, makes two commits, each on the one before",
    restsOn: "commit-response (committed: the commit's parent is the branch's head before)",
    run: async (world) => {
      const folder = await cut(world, "feature");
      await written(world, folder, { "first.txt": "first\n" });
      const first = fieldsOf(await world.output("commit", { folder, message: "Add the first file" }));
      await written(world, folder, { "first.txt": "changed\n" });
      const second = fieldsOf(await world.output("commit", { folder, message: "Change the first file" }));
      assert.deepEqual([first.how, second.how], ["committed", "committed"]);
      assert.deepEqual(await world.parentsOf(textOf(first.commit)), [world.base]);
      assert.deepEqual(await world.parentsOf(textOf(second.commit)), [textOf(first.commit)]);
      assert.equal(await world.headOf("forge/feature"), textOf(second.commit));
      assert.deepEqual(await world.filesOf(textOf(second.commit)), {
        ...(await world.filesOf(world.base)),
        "first.txt": "changed\n",
      });
      assert.deepEqual(await statusOf(world, folder), {
        head: textOf(second.commit),
        commits: [
          { hash: textOf(first.commit), subject: "Add the first file" },
          { hash: textOf(second.commit), subject: "Change the first file" },
        ],
        clean: true,
        changed: [],
        untracked: [],
      });
    },
  },
  {
    name: "commit with nothing but ignored files makes no commit, answers nothing changed with the branch's head, and keeps the ignored files",
    restsOn: "commit-response (nothing-changed: no commit was made, and the branch did not move)",
    run: async (world) => {
      const folder = await cut(world, "feature");
      await written(world, folder, { "run.log": "ignored\n" });
      assert.deepEqual(await world.output("commit", { folder, message: "Nothing to commit" }), {
        how: "nothing-changed",
        folder,
        branch: "forge/feature",
        commit: world.base,
      });
      assert.equal(await world.headOf("forge/feature"), world.base);
      assert.equal(await readFile(join(world.root, folder, "run.log"), "utf8"), "ignored\n");
    },
  },
  {
    name: "remove removes a copy, which is then not one the mode made",
    restsOn: "remove-request, remove-response (copy)",
    run: async (world) => {
      const folder = await copied(world, { commit: ownersBranch, name: "spent" });
      assert.deepEqual(await world.output("remove", { folder }), { folder, kind: "copy" });
      assert.equal(await exists(join(world.root, folder)), false);
      assert.equal(sentenceOf(await world.failure("remove", { folder })), givenReason);
    },
  },
  {
    name: "remove removes a clean worktree whose branch is merged, with its branch",
    restsOn:
      "remove-request (into; branchAfter: deleted, the default), remove-response (worktree, branchAfter deleted)",
    run: async (world) => {
      const folder = await cut(world, "done");
      assert.deepEqual(await world.output("remove", { folder, into: ownersBranch }), {
        folder,
        kind: "worktree",
        branch: "forge/done",
        branchAfter: "deleted",
      });
      assert.equal(await exists(join(world.root, folder)), false);
      assert.equal(await world.headOf("forge/done"), undefined);
    },
  },
  {
    name: "remove refuses a worktree with an untracked or a changed file, and keeps it, its files and its branch",
    restsOn: "remove-request (into: for a worktree); README, remove: only when the worktree is clean",
    run: async (world) => {
      const folder = await cut(world, "done");
      await written(world, folder, { "notes.txt": "Not committed.\n" });
      const untracked = await treeIn(world, folder);
      assert.equal(sentenceOf(await world.failure("remove", { folder, into: ownersBranch })), givenReason);
      assert.deepEqual(await treeIn(world, folder), untracked);
      await erased(world, folder, ["notes.txt"]);
      await written(world, folder, { "README.md": "Not yet committed.\n" });
      const changed = await treeIn(world, folder);
      assert.equal(sentenceOf(await world.failure("remove", { folder, into: ownersBranch })), givenReason);
      assert.deepEqual(await treeIn(world, folder), changed);
      assert.equal(await world.headOf("forge/done"), world.base);
    },
  },
  {
    name: "remove refuses a worktree whose branch is not merged, or with no branch named to be merged into, and keeps both",
    restsOn: "remove-request (into: the branch its own branch must be merged into before both are removed)",
    run: async (world) => {
      const folder = await cut(world, "done");
      const head = await world.commit(changeOn({ folder }, { "work.txt": "work\n" }, "Do the work"));
      const before = await treeIn(world, folder);
      assert.equal(sentenceOf(await world.failure("remove", { folder, into: ownersBranch })), givenReason);
      assert.equal(sentenceOf(await world.failure("remove", { folder })), givenReason);
      const deleted = { folder, into: ownersBranch, branchAfter: "deleted" };
      assert.equal(sentenceOf(await world.failure("remove", deleted)), givenReason);
      assert.deepEqual(await treeIn(world, folder), before);
      assert.equal(await world.headOf("forge/done"), head);
    },
  },
  {
    name: "remove with the branch kept removes a clean worktree, merged or not, and leaves its branch at its commit; a copy is removed as before",
    restsOn: "remove-request (branchAfter: kept), remove-response (worktree, branchAfter kept, commit)",
    run: async (world) => {
      const before = await ownersCheckout(world);
      const { folder, head } = await sliceWithCommit(world, { "feature.txt": "feature\n" });
      assert.deepEqual(await world.output("remove", { folder, branchAfter: "kept" }), {
        folder,
        kind: "worktree",
        branch: "forge/feature",
        branchAfter: "kept",
        commit: head,
      });
      assert.equal(await exists(join(world.root, folder)), false);
      assert.equal(await world.headOf("forge/feature"), head);
      assert.deepEqual(await world.filesOf(head), { ...(await world.filesOf(world.base)), "feature.txt": "feature\n" });
      assert.equal(sentenceOf(await world.failure("remove", { folder, branchAfter: "kept" })), givenReason);
      const merged = await cut(world, "merged");
      assert.deepEqual(await world.output("remove", { folder: merged, branchAfter: "kept" }), {
        folder: merged,
        kind: "worktree",
        branch: "forge/merged",
        branchAfter: "kept",
        commit: world.base,
      });
      assert.equal(await exists(join(world.root, merged)), false);
      assert.equal(await world.headOf("forge/merged"), world.base);
      const copy = await copied(world, { commit: ownersBranch, name: "spent" });
      assert.deepEqual(await world.output("remove", { folder: copy, branchAfter: "kept" }), {
        folder: copy,
        kind: "copy",
      });
      assert.equal(await exists(join(world.root, copy)), false);
      assert.deepEqual(await ownersCheckout(world), before);
    },
  },
  {
    name: "remove with the branch kept refuses a worktree with an untracked or a changed file, or with into named, and keeps it, its files and its branch",
    restsOn:
      "remove-request (branchAfter: kept, and into is not given); README, remove: only when the worktree is clean",
    run: async (world) => {
      const folder = await cut(world, "done");
      const head = await world.commit(changeOn({ folder }, { "work.txt": "work\n" }, "Do the work"));
      const kept = { folder, branchAfter: "kept" };
      await written(world, folder, { "notes.txt": "Not committed.\n" });
      const untracked = await treeIn(world, folder);
      assert.equal(sentenceOf(await world.failure("remove", kept)), givenReason);
      assert.deepEqual(await treeIn(world, folder), untracked);
      await erased(world, folder, ["notes.txt"]);
      await written(world, folder, { "README.md": "Not yet committed.\n" });
      const changed = await treeIn(world, folder);
      assert.equal(sentenceOf(await world.failure("remove", kept)), givenReason);
      assert.deepEqual(await treeIn(world, folder), changed);
      await written(world, folder, { "README.md": startFiles["README.md"] ?? "" });
      const clean = await treeIn(world, folder);
      assert.equal(sentenceOf(await world.failure("remove", { ...kept, into: ownersBranch })), givenReason);
      assert.deepEqual(await treeIn(world, folder), clean);
      assert.equal(await world.headOf("forge/done"), head);
    },
  },
  {
    name: "drop-branch deletes a branch the mode made, merged or not, and answers the commit it pointed at; a second drop answers not-there, and the slice can be cut again",
    restsOn:
      "drop-branch-request (branch: forge/<slice> or forge/wip/<slice>/<n>), drop-branch-response (dropped with the commit; not-there)",
    run: async (world) => {
      const { folder, head } = await sliceWithCommit(world, { "feature.txt": "feature\n" });
      await world.output("remove", { folder, branchAfter: "kept" });
      const merged = await cut(world, "merged");
      await world.output("remove", { folder: merged, branchAfter: "kept" });
      await world.makeBranch("forge/wip/feature/1", head);
      await cut(world, "busy");
      const before = await ownersCheckout(world);
      const dropped: readonly (readonly [string, string])[] = [
        ["forge/feature", head],
        ["forge/merged", world.base],
        ["forge/wip/feature/1", head],
      ];
      for (const [branch, commit] of dropped) {
        assert.deepEqual(await world.output("drop-branch", { branch, into: ownersBranch }), {
          how: "dropped",
          branch,
          commit,
        });
        assert.equal(await world.headOf(branch), undefined);
        assert.deepEqual(await world.output("drop-branch", { branch }), { how: "not-there", branch });
      }
      assert.deepEqual(await world.parentsOf(head), [world.base]);
      assert.deepEqual(await ownersCheckout(world), before);
      assert.deepEqual(await world.output("cut", { slice: "feature", base: ownersBranch }), {
        folder,
        branch: "forge/feature",
        commit: world.base,
      });
    },
  },
  {
    name: "drop-branch keeps a branch a live worktree of the mode still has, the branch named as into, and a branch under forge/ the mode never makes, and answers refused with its commit; once the worktree is removed its branch goes",
    restsOn:
      "drop-branch-request (into: never dropped), drop-branch-response (refused: the commit and a reason; dropped)",
    run: async (world) => {
      const { folder, head } = await sliceWithCommit(world, { "feature.txt": "feature\n" });
      await world.makeBranch("forge/integration", head);
      await world.makeBranch("forge/wip", world.base);
      await world.makeBranch("forge/by-hand/1", world.base);
      const before = await forgeTree(world);
      const refused: readonly (readonly [Fields, string])[] = [
        [{ branch: "forge/feature" }, head],
        [{ branch: "forge/integration", into: "forge/integration" }, head],
        [{ branch: "forge/wip" }, world.base],
        [{ branch: "forge/by-hand/1" }, world.base],
      ];
      for (const [input, commit] of refused) {
        const output = fieldsOf(await world.output("drop-branch", input));
        const branch = textOf(input.branch);
        assert.deepEqual(output, { how: "refused", branch, commit, reason: output.reason ?? null });
        assert.equal(sentenceOf(textOf(output.reason)), givenReason);
        assert.equal(await world.headOf(branch), commit);
      }
      assert.deepEqual(await forgeTree(world), before);
      await world.output("remove", { folder, branchAfter: "kept" });
      assert.deepEqual(await world.output("drop-branch", { branch: "forge/feature", into: "forge/integration" }), {
        how: "dropped",
        branch: "forge/feature",
        commit: head,
      });
      assert.equal(await world.headOf("forge/integration"), head);
    },
  },
  {
    name: "a worktree the mode made that no longer exists is refused by status, merge, set-aside and commit, and forgotten by remove with its branch kept",
    restsOn: "remove-response (forgotten); README, what it refuses: says so when the folder no longer exists",
    run: async (world) => {
      const folder = await cut(world, "lost");
      await world.makeBranch("integration", world.base);
      await rm(join(world.root, folder), { recursive: true, force: true });
      assert.equal(sentenceOf(await world.failure("status", { folder, base: ownersBranch })), givenReason);
      assert.equal(sentenceOf(await world.failure("merge", { folder, into: "integration" })), givenReason);
      assert.equal(sentenceOf(await world.failure("set-aside", { folder })), givenReason);
      assert.equal(sentenceOf(await world.failure("commit", { folder, message: "Lost" })), givenReason);
      const output = fieldsOf(await world.output("remove", { folder, into: ownersBranch }));
      assert.deepEqual(output, { folder, kind: "forgotten", reason: output.reason ?? null });
      assert.equal(sentenceOf(textOf(output.reason)), givenReason);
      assert.equal(await world.headOf("forge/lost"), world.base);
      assert.equal(await exists(join(world.root, folder)), false);
      assert.equal(sentenceOf(await world.failure("remove", { folder, into: ownersBranch })), givenReason);
    },
  },
  {
    name: "a copy the mode made that no longer exists is refused by overlay and apply, and forgotten by remove",
    restsOn: "remove-response (forgotten); README, what it refuses: says so when the folder no longer exists",
    run: async (world) => {
      const folder = await copied(world, { commit: ownersBranch, name: "lost" });
      await rm(join(world.root, folder), { recursive: true, force: true });
      const overlay = { folder, commit: ownersBranch, paths: ["README.md"] };
      assert.equal(sentenceOf(await world.failure("overlay", overlay)), givenReason);
      const patch = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-A\n+B\n";
      assert.equal(sentenceOf(await world.failure("apply", { folder, patch })), givenReason);
      assert.equal(await exists(join(world.root, folder)), false);
      const output = fieldsOf(await world.output("remove", { folder }));
      assert.deepEqual(output, { folder, kind: "forgotten", reason: output.reason ?? null });
      assert.equal(sentenceOf(textOf(output.reason)), givenReason);
      assert.equal(sentenceOf(await world.failure("remove", { folder })), givenReason);
    },
  },
  {
    name: "every action that takes a folder refuses one the mode did not make, and changes nothing in it",
    restsOn:
      "the folder of status-, overlay-, remove-, merge-, set-aside-, commit- and apply-request: a folder this mode made",
    run: async (world) => {
      const byHand = `${forgeData}/worktrees/by-hand`;
      await written(world, byHand, { "notes.txt": "made by hand\n" });
      await world.makeBranch("integration", world.base);
      const patch = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-A\n+B\n";
      const before = { forge: await forgeTree(world), owner: await ownersCheckout(world) };
      for (const folder of [byHand, "src"]) {
        const asked: readonly (readonly [string, Fields])[] = [
          ["status", { folder, base: ownersBranch }],
          ["overlay", { folder, commit: ownersBranch, paths: ["README.md"] }],
          ["remove", { folder, into: ownersBranch }],
          ["remove", { folder, branchAfter: "kept" }],
          ["merge", { folder, into: "integration" }],
          ["set-aside", { folder }],
          ["commit", { folder, message: "Commit by hand" }],
          ["apply", { folder, patch }],
        ];
        for (const [action, input] of asked) {
          assert.equal(sentenceOf(await world.failure(action, input)), givenReason, action);
        }
      }
      assert.deepEqual({ forge: await forgeTree(world), owner: await ownersCheckout(world) }, before);
      assert.equal(await world.headOf("integration"), world.base);
    },
  },
  {
    name: "status, merge, set-aside and commit refuse a copy; overlay and apply refuse a worktree; neither is changed",
    restsOn:
      "status-, merge-, set-aside- and commit-request (a worktree); overlay- and apply-request (a copy, never a worktree)",
    run: async (world) => {
      const worktree = await cut(world, "busy");
      const copy = await copied(world, { commit: ownersBranch, name: "spare" });
      await world.makeBranch("integration", world.base);
      await written(world, copy, { "notes.txt": "made in the copy\n" });
      const before = await forgeTree(world);
      const patch =
        "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-A small repository.\n+B\n";
      const asked: readonly (readonly [string, Fields])[] = [
        ["status", { folder: copy, base: ownersBranch }],
        ["merge", { folder: copy, into: "integration" }],
        ["set-aside", { folder: copy }],
        ["commit", { folder: copy, message: "Commit a copy" }],
        ["overlay", { folder: worktree, commit: ownersBranch, paths: ["README.md"] }],
        ["apply", { folder: worktree, patch }],
      ];
      for (const [action, input] of asked) {
        assert.equal(sentenceOf(await world.failure(action, input)), givenReason, action);
      }
      assert.deepEqual(await forgeTree(world), before);
      assert.equal(await world.headOf("integration"), world.base);
    },
  },
  {
    name: "names, commits and paths the schemas forbid are refused before any run starts",
    restsOn: "the patterns of each request schema",
    run: async (world) => {
      const commit = "A commit: a full or short hash, or a branch name. It has no .. and does not start with a dash.";
      const folderOf = (example: string, more: string): string =>
        `A ${more}this mode made, relative to the project, such as ${example}.`;
      const madeBranch =
        "A branch the mode made: forge/<slice>, as cut makes it, or forge/wip/<slice>/<n>, as set-aside makes it. " +
        "Letters, digits and dashes after forge/, in parts split by single slashes, each starting with a letter or " +
        "digit.";
      const refused: readonly (readonly [string, Fields, string])[] = [
        [
          "cut",
          { slice: "a/b", base: ownersBranch },
          "input.slice is not in the expected form. Expected: The slice's name: letters, digits and dashes, " +
            "starting with a letter or digit. The branch is forge/ and the name.",
        ],
        [
          "cut",
          { slice: "fine", base: "--orphan" },
          `input.base is not in the expected form. Expected: The commit the slice starts from. ${commit}`,
        ],
        [
          "status",
          { folder: "../outside", base: ownersBranch },
          `input.folder is not in the expected form. Expected: ${folderOf(".forge/worktrees/my-slice", "folder ")}`,
        ],
        [
          "changed",
          { from: ownersBranch, to: "a..b" },
          `input.to is not in the expected form. Expected: The later commit. ${commit}`,
        ],
        [
          "copy",
          { commit: ownersBranch, name: "-x" },
          "input.name is not in the expected form. Expected: The copy's name: letters, digits and dashes, " +
            "starting with a letter or digit.",
        ],
        [
          "copy",
          { commit: ownersBranch, name: "fine", links: ["../up"] },
          "input.links.0 is not in the expected form. Expected: A path git ignores in the project. A path " +
            "relative to the project's root. It has no .. and does not start with a dash.",
        ],
        [
          "overlay",
          { folder: ".forge/copies/x", commit: ownersBranch, paths: ["dir/../../README.md"] },
          "input.paths.0 is not in the expected form. Expected: A path relative to the copy, the same as relative " +
            "to the repository's root. It has no .. and does not start with a dash.",
        ],
        [
          "remove",
          { folder: "/tmp" },
          `input.folder is not in the expected form. Expected: ${folderOf(".forge/worktrees/my-slice", "folder ")}`,
        ],
        [
          "remove",
          { folder: ".forge/worktrees/x", branchAfter: "gone" },
          'input.branchAfter must be one of "deleted", "kept", but it is "gone".',
        ],
        [
          "merge",
          { folder: ".forge/worktrees/x", into: "-b" },
          "input.into is not in the expected form. Expected: The branch to merge the slice's branch into. It is " +
            "checked out nowhere, or only in the project's own folder; never in another worktree. It has no .. " +
            "and does not start with a dash.",
        ],
        [
          "set-aside",
          { folder: "a b" },
          `input.folder is not in the expected form. Expected: ${folderOf(".forge/worktrees/my-slice", "worktree ")}`,
        ],
        [
          "commit",
          { folder: ".forge/worktrees/x/../y", message: "Fine" },
          `input.folder is not in the expected form. Expected: ${folderOf(".forge/worktrees/my-slice", "worktree ")}`,
        ],
        [
          "commit",
          { folder: ".forge/worktrees/x", message: " \n\t" },
          "input.message is not in the expected form. Expected: The commit's message: its first line is the " +
            "subject. It has a character that is not a space, and no control character but tab and newline.",
        ],
        [
          "commit",
          { folder: ".forge/worktrees/x", message: "Fine\u0000" },
          "input.message is not in the expected form. Expected: The commit's message: its first line is the " +
            "subject. It has a character that is not a space, and no control character but tab and newline.",
        ],
        ["drop-branch", { branch: "main" }, `input.branch is not in the expected form. Expected: ${madeBranch}`],
        [
          "drop-branch",
          { branch: "forge/../main" },
          `input.branch is not in the expected form. Expected: ${madeBranch}`,
        ],
        ["drop-branch", { branch: "forge/-x" }, `input.branch is not in the expected form. Expected: ${madeBranch}`],
        [
          "drop-branch",
          { branch: "forge/x", into: "--all" },
          "input.into is not in the expected form. Expected: The branch the caller merges work into, which is " +
            "never dropped. It has no .. and does not start with a dash.",
        ],
        [
          "apply",
          { folder: "-x", patch: "x" },
          "input.folder is not in the expected form. Expected: A copy this mode made, relative to the project, " +
            "such as .forge/copies/my-copy. Never a worktree.",
        ],
      ];
      const before = { runs: await world.project.runs(), forge: await forgeTree(world) };
      for (const [action, input, message] of refused) {
        assert.equal(await world.refusal(action, input), message);
      }
      assert.deepEqual({ runs: await world.project.runs(), forge: await forgeTree(world) }, before);
    },
  },
  {
    name: "the owner's checked-out branch, its files and its uncommitted work are as they were after every action",
    restsOn:
      "merge-request (into: the checked-out branch is fast-forwarded only when the project's folder is clean); every request names a folder this mode made",
    run: async (world) => {
      await written(world, ".", {
        "README.md": "The owner's own change.\n",
        "notes.txt": "Not committed.\n",
        "deps/package.txt": "installed\n",
      });
      await erased(world, ".", ["src/main.txt"]);
      const before = await ownersCheckout(world);
      const { folder } = await sliceWithCommit(world, { "feature.txt": "feature\n" });
      await statusOf(world, folder);
      await world.output("changed", { from: ownersBranch, to: "forge/feature" });
      const copy = await copied(world, { commit: ownersBranch, name: "spare", links: ["deps"] });
      await world.output("overlay", { folder: copy, commit: "forge/feature", paths: ["feature.txt", "src"] });
      const patch =
        "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n" +
        "-A small repository.\n+Patched in the copy.\n";
      await world.output("apply", { folder: copy, patch });
      await targetWith(world, { "other.txt": "other\n" });
      await world.output("merge", { folder, into: "integration" });
      await written(world, folder, { "README.md": "Set aside.\n", "more.txt": "more\n" });
      await world.output("set-aside", { folder });
      await written(world, folder, { "committed.txt": "committed\n" });
      await world.output("commit", { folder, message: "Commit in the slice" });
      await world.output("remove", { folder: copy });
      const done = await cut(world, "done");
      await world.commit(changeOn({ folder: done }, { "done.txt": "done\n" }, "Do the other slice"));
      await world.output("remove", { folder: done, branchAfter: "kept" });
      await world.output("drop-branch", { branch: "forge/done", into: ownersBranch });
      await world.attempt("remove", { folder, into: "integration" });
      await world.attempt("merge", { folder, into: ownersBranch });
      assert.deepEqual(await ownersCheckout(world), before);
    },
  },
];

function worldOf(repository: Repository, underTest: WorktreesUnderTest): World {
  const { project } = repository;
  const reference = (action: string): string => `${underTest.mode}.${action}`;
  return {
    ...repository,
    root: project.root,
    ownData: underTest.ownData,
    output: (action, input) => project.output(reference(action), input),
    failure: (action, input) => project.failure(reference(action), input),
    refusal: (action, input) => project.refusal(reference(action), input),
    attempt: (action, input) => project.run(reference(action), input),
  };
}

export function testWorktrees(underTest: WorktreesUnderTest, testProject: TestProject = {}): void {
  const { mode } = underTest;
  for (const entry of cases) {
    test(`${interfaceName}@1, ${mode}: ${entry.name}`, async () => {
      const repository = await underTest.start({
        ...testProject,
        branch: ownersBranch,
        files: startFiles,
        ignored: ignoredPaths,
      });
      try {
        await entry.run(worldOf(repository, underTest));
      } finally {
        await repository.project.close();
      }
    });
  }
}
