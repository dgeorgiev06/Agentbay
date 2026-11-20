import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, before, test } from "node:test";
import { stringify } from "yaml";
import { failedTests, type ModeFiles } from "./kit-copy.ts";
import { memoryStore, memoryStoreFiles } from "./made-up-modes.ts";
import { almanac, almanacFiles, wrongAlmanac } from "./made-up-sources.ts";
import { tally, tallyFiles } from "./made-up-toolchains.ts";
import { casesThatNeedMergeSetAsideOrApply, shelf, shelfFiles } from "./made-up-worktrees.ts";
import { kit } from "./project-fixture.ts";

type Ran = {
  readonly status: number | null;
  readonly stdout: string;
  readonly output: string;
};

type Replacement = readonly [string | RegExp, string];

type MadeUpMode = {
  readonly name: string;
  readonly files: ModeFiles;
  readonly kitFolder: string;
  readonly ownLines?: readonly Replacement[];
  readonly trusted?: readonly string[];
};

const modesFolder = "components/modes";

const baseFolder = "components/base";

const digest = "digest";

const environment = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

const interfacesInTheKit = join(kit, baseFolder, "interfaces");

const sdkInTheKit = join(kit, "bay", "sdk.ts");

const relativeImport = /(from |import\()"(\.\.?\/[^"]+)"/g;

function projectLineOf(trusted: readonly string[]): Replacement {
  const trust = trusted.length === 0 ? "" : `, trusted: ${JSON.stringify(trusted)}`;
  return [/\}\);\n$/, `}, { project: import.meta.dirname${trust} });\n`];
}

const startHandedOn: Replacement = [`modes: ["${shelf}"] })`, `modes: ["${shelf}"] }, start)`];

const projectConfig = {
  adapter: "claude-code",
  bindings: { "items-store": "store" },
  settings: {
    [digest]: { title: "What the project keeps" },
    store: { monthlyUsd: { almanac: 1 } },
  },
};

const configWithoutBindings = { adapter: "claude-code", bindings: {} };

let project: string;

let trustedProject: string;

let untrustedProject: string;

let projectModesRan: Ran;

let wrongModeRan: Ran;

let trustedToolchainRan: Ran;

let trustedWorktreesRan: Ran;

let toolchainRan: Ran;

let worktreesRan: Ran;

function ran(folder: string, parameters: readonly string[]): Promise<Ran> {
  const child = spawn(process.execPath, parameters, { cwd: folder, env: environment });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve) => {
    child.on("close", (status) => {
      resolve({ status, stdout, output: `${stdout}${stderr}` });
    });
  });
}

function sharedTestFile(mode: string): string {
  return join(modesFolder, mode, "tests", `${mode}.test.ts`);
}

function sharedTestsRan(folder: string, modes: readonly string[]): Promise<Ran> {
  return ran(folder, ["--test", "--test-reporter=tap", ...modes.map(sharedTestFile)]);
}

function passedTests(output: string): readonly string[] {
  return [...output.matchAll(/^\s*ok \d+ - (.+)$/gm)].map((match) => match[1] ?? "");
}

function passedPerMode(output: string): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const name of passedTests(output)) {
    const mode = /^[a-z-]+@\d+, ([a-z-]+): /.exec(name)?.[1] ?? "no mode";
    counts[mode] = (counts[mode] ?? 0) + 1;
  }
  return counts;
}

function replaced(path: string, text: string, replacements: readonly Replacement[]): string {
  return replacements.reduce((changed, [from, to]) => {
    const next = changed.replace(from, to);
    assert.notEqual(next, changed, `${path} no longer holds ${String(from)}`);
    return next;
  }, text);
}

function placedInProject(folder: string, mode: MadeUpMode): ModeFiles {
  const inTheKit = join(kit, mode.kitFolder, mode.name);
  const inTheProject = join(folder, modesFolder, mode.name);
  const placedImport = (fileFolder: string, specifier: string): string => {
    const target = join(inTheKit, fileFolder, specifier);
    if (target.startsWith(`${inTheKit}/`)) {
      return specifier;
    }
    return target === sdkInTheKit ? "agentbay/sdk" : relative(join(inTheProject, fileFolder), target);
  };
  return Object.fromEntries(
    Object.entries(mode.files).map(([path, text]) => {
      const imports = text.replace(
        relativeImport,
        (_whole, before: string, specifier: string) => `${before}"${placedImport(dirname(path), specifier)}"`,
      );
      const projectLine = projectLineOf(mode.trusted ?? []);
      const ownLines = path === `tests/${mode.name}.test.ts` ? [...(mode.ownLines ?? []), projectLine] : [];
      return [path, replaced(path, imports, ownLines)];
    }),
  );
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function digestFiles(): Promise<ModeFiles> {
  const statusSchema = async (name: string): Promise<string> =>
    readFile(join(interfacesInTheKit, "items-store", `status-${name}.json`), "utf8");
  return {
    "mode.yaml": stringify({
      name: digest,
      version: "1.0.0",
      description: "Shows the counts of the items the project keeps; a mode of the project that needs the kit's store.",
      requires: { interfaces: ["items-store@1"] },
      settings: "schemas/settings.json",
      actions: {
        status: {
          description: "When the owner wants the counts of the items the project keeps.",
          input: "schemas/status-request.json",
          output: "schemas/status-response.json",
          effects: ["read"],
          run: [{ call: "items-store.status" }],
        },
      },
    }),
    "schemas/settings.json": json({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "DigestSettings",
      description: "Settings of the digest, given under settings.digest in agentbay.config.yaml.",
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: { title: { type: "string", description: "The name the owner gives the digest." } },
    }),
    "schemas/status-request.json": await statusSchema("request"),
    "schemas/status-response.json": await statusSchema("response"),
    "tests/status.example.json": json({ input: {}, output: { items: 0, deletions: 0, sources: [] } }),
  };
}

async function writeMode(folder: string, mode: string, files: ModeFiles): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const file = join(folder, modesFolder, mode, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }
}

async function projectWith(config: object, modes: readonly MadeUpMode[]): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "agentbay-project-modes-")));
  execFileSync("git", ["init", "-q"], { cwd: folder });
  await writeFile(join(folder, "agentbay.config.yaml"), stringify(config), "utf8");
  for (const mode of modes) {
    await writeMode(folder, mode.name, placedInProject(folder, mode));
  }
  return folder;
}

function toolModes(tallyTrusts: readonly string[], shelfTrusts: readonly string[]): readonly MadeUpMode[] {
  return [
    {
      name: tally,
      files: tallyFiles(tally, "stops a check at its limit"),
      kitFolder: baseFolder,
      trusted: tallyTrusts,
    },
    {
      name: shelf,
      files: shelfFiles(shelf, "keeps a changed worktree"),
      kitFolder: baseFolder,
      ownLines: [startHandedOn],
      trusted: shelfTrusts,
    },
  ];
}

before(async () => {
  project = await projectWith(projectConfig, [
    { name: almanac, files: almanacFiles(almanac, "continues after the cursor"), kitFolder: modesFolder },
    { name: wrongAlmanac, files: almanacFiles(wrongAlmanac, "repeats the item at the cursor"), kitFolder: modesFolder },
    { name: memoryStore, files: memoryStoreFiles(memoryStore, "keeps every item"), kitFolder: modesFolder },
  ]);
  await writeMode(project, digest, await digestFiles());
  trustedProject = await projectWith(configWithoutBindings, toolModes([tally], [shelf]));
  untrustedProject = await projectWith(configWithoutBindings, toolModes([], []));
  [projectModesRan, wrongModeRan, trustedToolchainRan, trustedWorktreesRan, toolchainRan, worktreesRan] =
    await Promise.all([
      sharedTestsRan(project, [almanac, memoryStore]),
      sharedTestsRan(project, [wrongAlmanac]),
      sharedTestsRan(trustedProject, [tally]),
      sharedTestsRan(trustedProject, [shelf]),
      sharedTestsRan(untrustedProject, [tally]),
      sharedTestsRan(untrustedProject, [shelf]),
    ]);
});

after(async () => {
  await rm(project, { recursive: true, force: true });
  await rm(trustedProject, { recursive: true, force: true });
  await rm(untrustedProject, { recursive: true, force: true });
});

test("bay check in a project beside the kit, with its own source, its own store and a mode that needs the kit's store, finds no errors", async () => {
  const checked = await ran(project, [join(kit, "bay", "cli.ts"), "check", "--json"]);
  assert.equal(checked.status, 0, checked.output);
  const report: unknown = JSON.parse(checked.stdout);
  assert.equal(typeof report === "object" && report !== null ? Reflect.get(report, "errors") : undefined, 0);
});

test("the project's source and store each pass every case of their interface's shared test, run from the project with node --test", () => {
  const tested = projectModesRan;
  assert.deepEqual(failedTests(tested.output), []);
  assert.equal(tested.status, 0, tested.output);
  assert.deepEqual(passedPerMode(tested.output), { [almanac]: 13, [memoryStore]: 23 });
  assert.match(tested.output, /^# pass 36$/m);
});

test("a project's source that repeats the item at the cursor fails the shared test's cases on the cursor, run from the project", () => {
  const tested = wrongModeRan;
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(
    failedTests(tested.output),
    [
      "fetching every page with the cursor gives every item once, oldest first, in the pages given, " +
        "and more is false only on the last",
      "the cursor of the last page gives no items and more false",
      "after the project is opened again, a page's cursor continues with the next page, and the last one with nothing",
      "no page costs less than nothing or more than describe's pageCostUsd, and the walk costs what the mode's test says",
    ].map((name) => `items-source@1, ${wrongAlmanac}: ${name}`),
  );
  assert.deepEqual(passedPerMode(tested.output), { [wrongAlmanac]: 9 });
});

test("a project's toolchain and worktrees modes, trusted in their tests, pass every case of their shared tests but the actions the worktrees mode does not build, run from the project", () => {
  assert.deepEqual(failedTests(trustedToolchainRan.output), []);
  assert.equal(trustedToolchainRan.status, 0, trustedToolchainRan.output);
  assert.deepEqual(passedPerMode(trustedToolchainRan.output), { [tally]: 33 });
  assert.equal(trustedWorktreesRan.status, 1, trustedWorktreesRan.output);
  assert.deepEqual(
    failedTests(trustedWorktreesRan.output),
    casesThatNeedMergeSetAsideOrApply.map((name) => `worktrees@1, ${shelf}: ${name}`),
  );
  assert.deepEqual(passedPerMode(trustedWorktreesRan.output), { [shelf]: 32 });
});

test("without trusted in their tests, a project's toolchain and worktrees modes load from the project, and a case that needs a listed command is refused with the broker's sentence and a sentence for the test's author", () => {
  assert.equal(toolchainRan.status, 1, toolchainRan.output);
  assert.deepEqual(passedPerMode(toolchainRan.output), { [tally]: 12 });
  assert.equal(worktreesRan.status, 1, worktreesRan.output);
  assert.deepEqual(passedPerMode(worktreesRan.output), { [shelf]: 5 });
  for (const [mode, tested] of [
    [tally, toolchainRan],
    [shelf, worktreesRan],
  ] as const) {
    assert.ok(
      tested.output.includes(
        `but the owner does not trust the list of mode ${mode}, so none of its commands or throwaway folders is ` +
          `granted. The owner reads the list and decides with: bay approve --trust ${mode}.`,
      ),
      tested.output,
    );
    assert.ok(
      tested.output.includes(
        "A test runs the commands of a mode outside the kit's components/base/ only when it trusts the mode. Name " +
          `it where the test opens the project: { project: import.meta.dirname, trusted: ["${mode}"] }.`,
      ),
      tested.output,
    );
  }
});
