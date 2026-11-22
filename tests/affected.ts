import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path/posix";

export type Tier = "mode" | "manifest" | "all";

export type Affected = {
  readonly tier: Tier;
  readonly files: readonly string[];
  readonly why: string;
};

export type Change = {
  readonly changed: readonly string[];
  readonly testFiles: readonly string[];
  readonly modeFolders: readonly string[];
};

type Placed =
  | { readonly kind: "document"; readonly path: string }
  | { readonly kind: "mode"; readonly path: string; readonly folder: string }
  | { readonly kind: "manifest"; readonly path: string; readonly folder: string }
  | { readonly kind: "unplaced"; readonly path: string };

export const testsThatOpenTheKit: readonly string[] = [
  "components/base/forge/tests/listed-commands.test.ts",
  "components/base/forge/tests/one-slice.test.ts",
  "components/base/forge/tests/waves.test.ts",
  "components/base/git-worktrees/tests/listed-commands.test.ts",
  "components/base/git-worktrees/tests/with-typescript.test.ts",
  "components/base/proof/tests/listed-commands.test.ts",
  "components/base/typescript/tests/kit.test.ts",
  "components/base/typescript/tests/listed-commands.test.ts",
  "tests/capture-fixtures.test.ts",
  "tests/check-imports.test.ts",
  "tests/feature-map.test.ts",
  "tests/forge-in-a-project.test.ts",
  "tests/forge-worktree-check.test.ts",
  "tests/kit-check.test.ts",
  "tests/lint-ignores.test.ts",
  "tests/living-documents.test.ts",
  "tests/made-up-proofs.test.ts",
  "tests/made-up-requirements.test.ts",
  "tests/made-up-sources.test.ts",
  "tests/made-up-toolchains.test.ts",
  "tests/made-up-worktrees.test.ts",
  "tests/new-mode-isolation.test.ts",
  "tests/readme-references.test.ts",
  "tests/shared-tests-in-a-project.test.ts",
  "tests/test-toolbox.ts",
];

const manifestFolders = ["schemas/", "workflows/", "skills/"];

const testFile = /(^|\/)(test|test-[^/]*|[^/]*[.\-_]test)\.[cm]?[jt]s$|(^|\/)test\/[^/].*\.[cm]?[jt]s$/;

export const cheapChecks: readonly string[] = ["generate:check", "typecheck", "lint", "format:check", "deadcode"];

const reminder =
  "These are the tests this change needs before a merge. The whole suite still runs on the merged branch.";

function isInside(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`);
}

const documentsNoTestReads: readonly string[] = ["README.md", "CONTEXT.md"];

function isDocument(path: string): boolean {
  return path.startsWith("docs/") || documentsNoTestReads.includes(path);
}

function placed(path: string, modeFolders: readonly string[]): Placed {
  const folder = modeFolders.find((mode) => isInside(path, mode));
  if (folder === undefined) {
    return isDocument(path) ? { kind: "document", path } : { kind: "unplaced", path };
  }
  const inFolder = path.slice(folder.length + 1);
  if (inFolder === "mode.yaml" || manifestFolders.some((manifest) => inFolder.startsWith(manifest))) {
    return { kind: "manifest", path, folder };
  }
  return { kind: "mode", path, folder };
}

function noTests(changed: readonly string[]): Affected {
  const why = changed.length === 0 ? "Nothing changed." : "Only documents changed, and they need no test.";
  return { tier: "mode", files: [], why };
}

export function affectedTests(change: Change): Affected {
  const places = change.changed.map((path) => placed(path, change.modeFolders));
  const unplaced = places.find((place) => place.kind === "unplaced");
  if (unplaced !== undefined) {
    const why = `${unplaced.path} is outside every mode folder, so the whole suite runs.`;
    return { tier: "all", files: change.testFiles, why };
  }
  const folders = [
    ...new Set(places.flatMap((place) => (place.kind === "mode" || place.kind === "manifest" ? [place.folder] : []))),
  ];
  if (folders.length === 0) {
    return noTests(change.changed);
  }
  const ownTests = (file: string): boolean => folders.some((folder) => isInside(file, folder));
  const manifest = places.find((place) => place.kind === "manifest");
  if (manifest !== undefined) {
    return {
      tier: "manifest",
      files: change.testFiles.filter((file) => ownTests(file) || testsThatOpenTheKit.includes(file)),
      why: `${manifest.path} is a manifest, schema, workflow or skill of a mode, so the tests that open the kit run too.`,
    };
  }
  return {
    tier: "mode",
    files: change.testFiles.filter(ownTests),
    why: `Every changed path is inside ${folders.join(" or ")}, and none is a manifest, schema, workflow or skill.`,
  };
}

function gitLines(parameters: readonly string[], folder: string): readonly string[] {
  return execFileSync("git", parameters, { cwd: folder, encoding: "utf8" })
    .split("\n")
    .filter((line) => line !== "");
}

function repositoryFiles(): readonly string[] {
  return gitLines(["ls-files", "--cached", "--others", "--exclude-standard"], ".").filter((file) => existsSync(file));
}

export function repositoryTestFiles(): readonly string[] {
  return repositoryFiles().filter((file) => testFile.test(file));
}

export function changedSince(base: string, folder: string): readonly string[] {
  const committed = gitLines(["diff", "--name-only", "--no-renames", `${base}...HEAD`], folder);
  const uncommitted = gitLines(["diff", "--name-only", "--no-renames", "HEAD"], folder);
  const untracked = gitLines(["ls-files", "--others", "--exclude-standard"], folder);
  return [...new Set([...committed, ...uncommitted, ...untracked])];
}

function modeFoldersOf(files: readonly string[]): readonly string[] {
  return files.filter((file) => file.startsWith("components/") && basename(file) === "mode.yaml").map(dirname);
}

function ran(parameters: readonly string[]): boolean {
  return spawnSync("npm", parameters, { stdio: "inherit" }).status === 0;
}

function testsRan(affected: Affected): boolean {
  if (affected.files.length === 0) {
    console.log("No test file to run.");
    return true;
  }
  return ran(affected.tier === "all" ? ["test"] : ["test", "--", ...affected.files]);
}

function checked(base: string): boolean {
  const files = repositoryFiles();
  const change = { changed: changedSince(base, "."), testFiles: files.filter((file) => testFile.test(file)) };
  const affected = affectedTests({ ...change, modeFolders: modeFoldersOf(files) });
  console.log(`Tier: ${affected.tier}`);
  console.log(`Why: ${affected.why}`);
  console.log(`Test files: ${String(affected.files.length)}`);
  console.log(reminder);
  const staticChecks = cheapChecks.every((script) => ran(["run", script]));
  return staticChecks && testsRan(affected);
}

if (import.meta.main) {
  const base = process.argv[2];
  if (base === undefined) {
    console.log("Name the base the change is measured from: npm run test:affected -- <base>");
    process.exitCode = 2;
  } else {
    process.exitCode = checked(base) ? 0 : 1;
  }
}
