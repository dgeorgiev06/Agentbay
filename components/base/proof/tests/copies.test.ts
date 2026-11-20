import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";

type Files = Readonly<Record<string, string>>;

const standIn = "stand-in";

const askedFolder = ".stand-in";

const stoppedAtItsLimit = "It did not finish within its time limit and was stopped.";

const askedSeconds =
  '(typeof input === "object" && input !== null && !Array.isArray(input) ? input.timeLimitSeconds : 0)';

const sdk = join(import.meta.dirname, "..", "..", "..", "..", "bay", "sdk.ts");

const everyEffect = "[read, write, network, spend, delete]";

function standInManifest(): string {
  const action = (name: string, effects: string): readonly string[] => [
    `  ${name}:`,
    `    description: When proof's own test needs the made-up toolchain's ${name}.`,
    `    effects: ${effects}`,
    "    run:",
    `      - script: scripts/${name}.ts`,
  ];
  return [
    `name: ${standIn}`,
    "version: 1.0.0",
    "description: A made-up toolchain for proof's own test; it runs nothing, records what it is asked, and stops every test run at its limit.",
    "implements: [toolchain@1]",
    "resources:",
    `  files: { read: [${askedFolder}], write: [${askedFolder}] }`,
    "actions:",
    ...action("describe", "[read]"),
    ...action("check", everyEffect),
    ...action("test", everyEffect),
    ...action("run", everyEffect),
    "",
  ].join("\n");
}

function recordingScript(action: string, answer: string): string {
  return [
    `import { defineScript, fail } from "${sdk}";`,
    "",
    "export const run = defineScript(async (input, context) => {",
    '  const folder = typeof input === "object" && input !== null && !Array.isArray(input) ? input.folder : undefined;',
    `  const file = "${askedFolder}/${action}-" + (typeof folder === "string" ? folder.split("/").join("-") : "project") + ".json";`,
    "  const written = await context.files.write(file, JSON.stringify(input));",
    "  if (!written.ok) {",
    "    fail(written.message);",
    "  }",
    `  return ${answer};`,
    "});",
    "",
  ].join("\n");
}

const standInFiles: Files = {
  "mode.yaml": standInManifest(),
  "README.md": "# stand-in\n\nA made-up toolchain for proof's own test.\n",
  "scripts/describe.ts": [
    `import { defineScript } from "${sdk}";`,
    "",
    "export const run = defineScript(() =>",
    "  Promise.resolve({",
    '    language: "Made-up",',
    '    sourceFiles: ["**"],',
    '    testFiles: ["tests/**"],',
    '    practices: "practices.md",',
    '    checks: ["lint", "types"],',
    '    present: ["lint", "types", "test"],',
    "    missing: [],",
    "  }),",
    ");",
    "",
  ].join("\n"),
  "scripts/check.ts": recordingScript(
    "check",
    '{ verdicts: ["lint", "types"].map((name) => ({ name, verdict: "passed", seconds: 0, stdout: "", stderr: "" })) }',
  ),
  "scripts/test.ts": recordingScript(
    "test",
    `{ verdict: "inconclusive", reason: "${stoppedAtItsLimit}", seconds: ${askedSeconds}, stdout: "", stderr: "" }`,
  ),
  "scripts/run.ts": recordingScript(
    "run",
    `{ ended: "timed-out", reason: "${stoppedAtItsLimit}", seconds: 0, stdout: "", stdoutCut: false }`,
  ),
};

const hiddenTest = "tests/.hidden.test.ts";

const refused =
  "The input of action test of mode stand-in does not match its schema: input.files.0 is not in the expected form. " +
  "Expected: A test file, relative to the checkout; it cannot leave the checkout or start with a dash.";

let project: ModeProject;

let configured: ModeProject;

function git(on: ModeProject, ...parameters: readonly string[]): string {
  const identity = ["-c", "user.name=Proof Test", "-c", "user.email=proof-test@agentbay.invalid"];
  return execFileSync("git", [...identity, ...parameters], { cwd: on.root, encoding: "utf8" });
}

async function writeFiles(root: string, files: Files): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, "utf8");
  }
}

async function committed(on: ModeProject, files: Files): Promise<string> {
  await writeFiles(on.root, files);
  git(on, "add", "--all");
  git(on, "commit", "--quiet", "--message", "A commit for proof's own test");
  return git(on, "rev-parse", "HEAD").trim();
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

async function asked(on: ModeProject, action: string): Promise<readonly unknown[]> {
  const folder = join(on.root, askedFolder);
  const names = (await readdir(folder)).filter((name) => name.startsWith(`${action}-`)).sort();
  return Promise.all(
    names.map(async (name) => {
      const parsed: unknown = JSON.parse(await readFile(join(folder, name), "utf8"));
      return parsed;
    }),
  );
}

async function standInProject(proofSettings: Readonly<Record<string, Json>>): Promise<ModeProject> {
  const given = await realpath(await mkdtemp(join(tmpdir(), "agentbay-proof-copies-")));
  let opened: ModeProject;
  try {
    await writeFiles(given, {
      "agentbay.config.yaml": "adapter: claude-code\nbindings: {}\n",
      ...Object.fromEntries(
        Object.entries(standInFiles).map(([path, text]) => [`components/modes/${standIn}/${path}`, text]),
      ),
    });
    opened = await openModeProject(
      {
        adapter: "claude-code",
        modes: ["proof", "git-worktrees", standIn],
        bindings: { toolchain: standIn, worktrees: "git-worktrees" },
        settings: { proof: proofSettings },
      },
      { project: given },
    );
  } finally {
    await rm(given, { recursive: true, force: true });
  }
  await mkdir(join(opened.root, "node_modules"), { recursive: true });
  await mkdir(join(opened.root, askedFolder), { recursive: true });
  return opened;
}

before(async () => {
  project = await standInProject({});
  configured = await standInProject({ stepSeconds: 3600, longestCallSeconds: 2400 });
});

after(async () => {
  await project.close();
  await configured.close();
});

test("every copy is removed when the toolchain stops a run at its limit, when a called action refuses what proof hands it midway and when a named test is not at the head; a check call shares the time among the checks", async () => {
  const ignored = [".agentbay/", ".forge/", `${askedFolder}/`, "node_modules", "components/", "agentbay.config.yaml"];
  const base = await committed(project, { ".gitignore": `${ignored.join("\n")}\n`, "src/value.txt": "1\n" });
  const head = await committed(project, { "src/value.txt": "2\n", [hiddenTest]: "a test only a dot hides\n" });
  const output = await project.output("proof.prove", {
    slice: {
      name: "COPIES",
      kind: "mode",
      scope: ["src/**", "tests/**"],
      after: [],
      done: [
        { id: "checked", says: "The checks pass.", level: "must", proof: { kind: "checks" } },
        {
          id: "first",
          says: "A test fails first.",
          level: "must",
          proof: { kind: "fails-first", tests: [hiddenTest] },
        },
        {
          id: "gone",
          says: "A test that was never written fails first.",
          level: "must",
          proof: { kind: "fails-first", tests: ["tests/gone.test.ts"] },
        },
      ],
    },
    base,
    head,
    declared: { files: ["src/value.txt", hiddenTest], names: { gained: [], lost: [], changed: [] } },
    bugs: [],
  });
  assert.deepEqual(fieldOf(output, "size"), [
    { path: "src/value.txt", base: 1, head: 1 },
    { path: hiddenTest, head: 1 },
  ]);
  assert.deepEqual(fieldOf(output, "verdicts"), [
    {
      item: "checked",
      kind: "checks",
      verdict: "inconclusive",
      reason:
        `The test run is not known: ${stoppedAtItsLimit} Proof asked for 1000 seconds, the most it asks for one call; ` +
        "settings.proof.longestCallSeconds in agentbay.config.yaml raises it.",
    },
    {
      item: "first",
      kind: "fails-first",
      verdict: "inconclusive",
      reason:
        `The run on the base could not start: ${refused} The run on the head could not start: ` +
        "Proof's own step of 1800 seconds had no time left for it, so it was not made; " +
        "settings.proof.stepSeconds in agentbay.config.yaml raises the step.",
    },
    {
      item: "gone",
      kind: "fails-first",
      verdict: "failed",
      detail: "These test files do not exist at the head, so they cannot show the change: tests/gone.test.ts.",
    },
    { item: "scope", kind: "in-scope", verdict: "passed", detail: "Every changed path is in the scope: 2 of 2." },
    {
      item: "declared",
      kind: "as-declared",
      verdict: "passed",
      detail: "What changed is as declared: 2 files and 0 action names.",
    },
  ]);
  assert.deepEqual(await readdir(join(project.root, ".forge", "copies")), []);
  const given = async (action: string): Promise<readonly unknown[]> =>
    (await asked(project, action)).map((request) => [
      fieldOf(request, "timeLimitSeconds"),
      String(fieldOf(request, "folder")).startsWith(".forge/copies/proof-"),
    ]);
  assert.deepEqual(await given("check"), [[865, true]]);
  assert.deepEqual(await given("test"), [[1000, true]]);
});

const ignoredByTheSecond = [
  ".agentbay/",
  ".forge/",
  `${askedFolder}/`,
  "node_modules",
  "components/",
  "agentbay.config.yaml",
];

const checksOnly = {
  name: "LIMITS",
  kind: "mode",
  scope: ["src/**"],
  after: [],
  done: [{ id: "checked", says: "The checks pass.", level: "must", proof: { kind: "checks" } }],
};

test("a project's settings.proof.longestCallSeconds and stepSeconds are what proof asks the toolchain for, and a run stopped at that limit names the setting", async () => {
  const base = await committed(configured, { ".gitignore": `${ignoredByTheSecond.join("\n")}\n`, "src/v.txt": "1\n" });
  const head = await committed(configured, { "src/v.txt": "2\n" });
  const output = await configured.output("proof.prove", {
    slice: checksOnly,
    base,
    head,
    declared: { files: ["src/v.txt"], names: { gained: [], lost: [], changed: [] } },
    bugs: [],
  });
  const timeLimits = async (action: string): Promise<readonly unknown[]> =>
    (await asked(configured, action)).map((request) => fieldOf(request, "timeLimitSeconds"));
  assert.deepEqual([await timeLimits("check"), await timeLimits("test")], [[1765], [2400]]);
  assert.deepEqual(fieldOf(output, "verdicts"), [
    {
      item: "checked",
      kind: "checks",
      verdict: "inconclusive",
      reason:
        `The test run is not known: ${stoppedAtItsLimit} Proof asked for 2400 seconds, the most it asks for one call; ` +
        "settings.proof.longestCallSeconds in agentbay.config.yaml raises it.",
    },
    { item: "scope", kind: "in-scope", verdict: "passed", detail: "Every changed path is in the scope: 1 of 1." },
    {
      item: "declared",
      kind: "as-declared",
      verdict: "passed",
      detail: "What changed is as declared: 1 file and 0 action names.",
    },
  ]);
});

test("settings.proof refuses a longest call over the 3600 seconds toolchain@1 allows and a step over the 7200 its manifest declares, and accepts both at those limits", async () => {
  const refusal = async (settings: Readonly<Record<string, Json>>): Promise<string> => {
    try {
      const opened = await standInProject(settings);
      await opened.close();
      return "accepted";
    } catch (error) {
      return /settings\.proof\.[A-Za-z]+ must [^."]+\./.exec(String(error))?.[0] ?? String(error);
    }
  };
  assert.deepEqual(
    [
      await refusal({ longestCallSeconds: 3601 }),
      await refusal({ stepSeconds: 7201 }),
      await refusal({ stepSeconds: 119 }),
      await refusal({ longestCallSeconds: 3600, stepSeconds: 7200 }),
    ],
    [
      "settings.proof.longestCallSeconds must be at most 3600, but it is 3601.",
      "settings.proof.stepSeconds must be at most 7200, but it is 7201.",
      "settings.proof.stepSeconds must be at least 120, but it is 119.",
      "accepted",
    ],
  );
});
