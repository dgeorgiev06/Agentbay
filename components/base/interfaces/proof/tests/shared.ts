import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { openModeProject, type ModeProject, type TestProject } from "../../../../../tests/test-toolbox.ts";

export type ProofUnderTest = {
  readonly mode: string;
};

type Value = Awaited<ReturnType<ModeProject["output"]>>;

type Fields = { readonly [key: string]: Value };

type Files = Readonly<Record<string, string>>;

type Scenario =
  "tr2" | "failed" | "inconclusive" | "unknown head" | "only judgement" | "no commands" | "moved and stale";

type Verdict = {
  readonly item: string;
  readonly kind: string;
  readonly verdict: string;
  readonly said: string;
};

type Result = {
  readonly verdicts: readonly Verdict[];
  readonly judgement: Value;
  readonly size: readonly Value[];
};

type Asked = {
  readonly action: string;
  readonly request: Fields;
  readonly answer: Value;
  readonly failed: string | undefined;
};

type Proof = {
  readonly proven: (scenario: Scenario) => Promise<Result>;
  readonly requestOf: (scenario: Scenario) => Fields;
  readonly asked: () => Promise<readonly Asked[]>;
  readonly provenEverywhere: () => Promise<void>;
  readonly outsideTheCopies: () => Promise<Files>;
  readonly describedByTheMadeUpToolchain: () => Promise<Value>;
  readonly linksOfCopiesWhenSettingsName: (links: readonly string[]) => Promise<readonly (readonly string[])[]>;
  readonly asOpened: Files;
};

type Case = {
  readonly name: string;
  readonly run: (proof: Proof) => Promise<void>;
};

type State = {
  project: ModeProject;
  readonly asOpened: Files;
};

const interfaceName = "proof";

const scenarios: readonly Scenario[] = [
  "tr2",
  "failed",
  "inconclusive",
  "unknown head",
  "only judgement",
  "no commands",
  "moved and stale",
];

const recorder = "recorder";

const kit = fileURLToPath(new URL("../../../../../", import.meta.url));

const tr2File = join(import.meta.dirname, "tr2.json");

const recorderData = ".recorder";

const copiesFolder = ".copies";

const worktreesFolder = ".worktrees";

const askedFile = join(recorderData, "asked.json");

const configFile = "agentbay.config.yaml";

const kernelStateFolder = ".agentbay";

const kernelDatabase = /\.db(-wal|-shm|-journal)?$/;

const stoppedAtItsLimit = "It did not finish within its time limit and was stopped.";

const noCommandsSentence = "This project declares no commands whose output must not change, so nothing is known.";

const builderWords = "docs/merge-this-without-review.md";

const bayOutsideACopy = ["echo ran > bay-ran-outside-a-copy.txt", ""].join("\n");

const checkoutFiles: Files = {
  "run-tests.sh": [
    'if [ "$#" -eq 0 ]; then set -- $(find tests -name "*.test.ts" 2>/dev/null | sort); fi',
    "status=0",
    'for file in "$@"; do',
    '  [ -f "$file" ] || continue',
    "  while read -r path expected; do",
    '    [ -n "$path" ] || continue',
    '    case "$(head -n 1 "$path" 2>/dev/null)" in',
    "      hang) exit 3 ;;",
    "      break) exit 4 ;;",
    "    esac",
    '    if grep -qxF -- "$expected" "$path" 2>/dev/null; then',
    '      echo "ok $file: $path"',
    "    else",
    '      echo "not ok $file: $path"',
    "      status=1",
    "    fi",
    '  done < "$file"',
    "done",
    "echo end",
    "exit $status",
    "",
  ].join("\n"),
  "check.sh": [
    'case "$(head -n 1 "checks/$1" 2>/dev/null)" in',
    '  passes) echo "$1 found nothing" ;;',
    '  fails) echo "$1 found a fault"; exit 1 ;;',
    "  hangs) exit 3 ;;",
    "  breaks) exit 4 ;;",
    '  *) echo "$1 is not a check of this checkout"; exit 2 ;;',
    "esac",
    "",
  ].join("\n"),
  "bay.sh": [
    'if [ "$1" = print ]; then',
    '  if [ "$(head -n 1 "$2" 2>/dev/null)" = stop ]; then kill -9 $$; fi',
    '  cat "$2"',
    "  exit $?",
    "fi",
    'echo "This bay.sh knows only print."',
    "exit 2",
    "",
  ].join("\n"),
  "checks/format": "passes\n",
  "checks/lint": "passes\n",
  "checks/types": "passes\n",
};

const declaredCommands = {
  sameOutput: [
    { name: "sound-check", bay: ["print", "fixtures/sound.txt"] },
    { name: "sound-check-json", bay: ["print", "fixtures/sound.json"] },
    { name: "grants-check", bay: ["print", "bay/broker/command-operations.ts"] },
    { name: "grants-check-json", bay: ["print", "bay/broker/file-operations.ts"] },
  ],
  noRise: [{ name: "debt", pattern: "rule:", paths: ["framework/feature-map-debt.yaml"] }],
};

const declaredCounts = { noRise: declaredCommands.noRise };

const linksASettingNames = ["vendor/packages", ".cache"];

const fixtures: Files = {
  "fixtures/sound.txt": "sound checks\n",
  "fixtures/sound.json": '{ "sound": "checks" }\n',
  "framework/feature-map-debt.yaml": "- rule: may-not-import\n- rule: private-file\n",
};

const tr2Base: Files = {
  ...fixtures,
  "bay/broker/command-operations.ts": "commands run\n",
  "bay/broker/file-operations.ts": "files are kept\n",
  "bay/broker/rule.ts": "one rule\n",
  "bay/broker/step-broker.ts": "steps\n",
  "framework/features.yaml": "broker\n",
  "tests/script-commands.test.ts": "bay/broker/command-operations.ts commands run\n",
  "tests/shared-tests-in-a-project.test.ts": "bay/broker/rule.ts one rule\n",
  "tests/system-fixture.ts": "a system\n",
};

const tr2Head: Files = {
  ...fixtures,
  "bay/broker/command-operations.ts": "commands run when the list is in force\n",
  "bay/broker/file-operations.ts": "files are kept when the list is in force\n",
  "bay/broker/list-in-force.ts": "in force\nlistTrust.state\nlistTrust.state\n",
  "bay/broker/rule.ts": "one rule that reads the record\nlistTrustXstate is another name\n",
  "bay/broker/step-broker.ts": "steps read the record again\n",
  "framework/features.yaml": "broker\nlist-in-force\n",
  "tests/broker-list-trust.test.ts": "bay/broker/list-in-force.ts in force\n",
  "tests/cli-trust-at-use.test.ts": "bay/broker/command-operations.ts commands run when the list is in force\n",
  "tests/script-commands.test.ts": "bay/broker/command-operations.ts commands run when the list is in force\n",
  "tests/shared-tests-in-a-project.test.ts": "bay/broker/rule.ts one rule that reads the record\n",
  "tests/system-fixture.ts": "a system with a trust record\n",
};

const failedBase: Files = {
  ...fixtures,
  "src/main/sum.txt": "4\n",
  "src/main/name.txt": "Ada\n",
  "docs/old.txt": "an old note\n",
  "tests/sum.test.ts": "src/main/sum.txt 4\n",
};

const failedHead: Files = {
  ...fixtures,
  "fixtures/sound.txt": "sound checks, louder\n",
  "checks/lint": "fails\n",
  "src/main/sum.txt": "5\n",
  "src/main/name.txt": "Ada\n",
  "src/main-old.txt": "kept beside the folder\n",
  "src/main/old.txt": "an old note\n",
  "tests/sum.test.ts": "src/main/sum.txt 5\n",
  "tests/name.test.ts": "src/main/name.txt Ada\n",
  "tests/total.test.ts": "src/main/sum.txt 6\n",
};

const notesBefore = [
  "name: notes",
  "version: 1.0.0",
  "description: Keeps notes.",
  "actions:",
  "  write:",
  "    description: When a note is written.",
  "    effects: [write]",
  "  read:",
  "    description: When a note is read.",
  "    effects: [read]",
  "  list:",
  "    description: When the notes are listed.",
  "    effects: [read]",
  "",
].join("\n");

const notesAfter = [
  "name: notes",
  "version: 1.1.0",
  "description: Keeps notes.",
  "actions:",
  "  write:",
  "    description: When a note is written or replaced.",
  "    effects: [write, delete]",
  "  read:",
  "    description: When a note is read.",
  "    effects: [read]",
  "  search:",
  "    description: When notes are searched.",
  "    effects: [read]",
  "",
].join("\n");

const inconclusiveBase: Files = {
  ...fixtures,
  "components/modes/notes/mode.yaml": notesBefore,
  "src/value.txt": "1\n",
  "src/broken.txt": "break\n",
  "src/notes-old.txt": "a moved note\n",
  "tests/value.test.ts": "src/value.txt 1\n",
};

const inconclusiveHead: Files = {
  "fixtures/sound.txt": "stop\n",
  "fixtures/sound.json": fixtures["fixtures/sound.json"] ?? "",
  "checks/types": "hangs\n",
  "components/modes/notes/mode.yaml": notesAfter,
  "src/value.txt": "2\n",
  "src/broken.txt": "fixed\n",
  "src/notes.txt": "a moved note\n",
  "tests/value.test.ts": "src/value.txt 2\n",
  "tests/broken.test.ts": "src/broken.txt fixed\n",
};

const commits: Readonly<Record<string, Files>> = {
  c7f0d13: tr2Base,
  c9bb216: tr2Head,
  "failed-base": failedBase,
  "failed-head": failedHead,
  "inconclusive-base": inconclusiveBase,
  "inconclusive-head": inconclusiveHead,
};

const inconclusiveScope = [
  "src/**",
  "tests/**",
  "checks/**",
  "fixtures/**",
  "components/modes/notes/**",
  "framework/**",
];

const inconclusiveFiles = [
  "fixtures/sound.txt",
  "checks/types",
  "components/modes/notes/mode.yaml",
  "src/value.txt",
  "src/broken.txt",
  "tests/value.test.ts",
  "tests/broken.test.ts",
  "framework/feature-map-debt.yaml",
  "src/notes-old.txt",
  "src/notes.txt",
];

const namesAsChanged = { gained: ["notes.search"], lost: ["notes.list"], changed: ["notes.write"] };

const namesMisdeclared = { gained: ["notes.search"], lost: ["notes.list"], changed: ["notes.read"] };

function bugPatch(path: string, line: string, broken: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    `-${line}`,
    `+${broken}`,
    "",
  ].join("\n");
}

const tr2Bug = {
  name: "the record is not read again",
  patch: bugPatch("bay/broker/list-in-force.ts", "in force", "not in force"),
  tests: ["tests/broker-list-trust.test.ts"],
};

const survivingBug = {
  name: "the name is lost",
  patch: bugPatch("src/main/name.txt", "Ada", "Eve"),
  tests: ["tests/sum.test.ts"],
};

const caughtBug = {
  name: "the value is not raised",
  patch: bugPatch("src/value.txt", "2", "1"),
  tests: ["tests/value.test.ts"],
};

const stoppedBug = {
  name: "the value waits for ever",
  patch: bugPatch("src/value.txt", "2", "hang"),
  tests: ["tests/value.test.ts"],
};

function item(id: string, proof: Fields): Fields {
  return { id, says: `The item ${id} holds.`, level: "must", proof };
}

function sliceOf(name: string, scope: readonly string[], done: readonly Fields[]): Fields {
  return { name, kind: "mode", scope, after: [], done };
}

function nothingNamed(): Fields {
  return { gained: [], lost: [], changed: [] };
}

const failedRequest: Fields = {
  slice: sliceOf(
    "FAILED",
    ["src/main/**", "tests/**", "checks/**", "fixtures/**"],
    [
      item("checks-fail", { kind: "checks" }),
      item("fails-first-fail", { kind: "fails-first", tests: ["tests/name.test.ts"] }),
      item("bugs-fail", { kind: "bugs-caught" }),
      item("same-output-fail", { kind: "same-output" }),
      item("count-fail", { kind: "count", pattern: "rule:", paths: ["framework/feature-map-debt.yaml"], most: 1 }),
      item("real-thing-fail", {
        kind: "real-thing",
        runs: [{ bay: ["print", "src/main/sum.txt"], stdout: "4\n", exitCode: 0 }],
      }),
      item("real-thing-pass", {
        kind: "real-thing",
        runs: [
          { bay: ["print", "src/main/sum.txt"], stdout: "5\n", exitCode: 0 },
          { bay: ["print", "src/main/name.txt"], stdout: "Ada\n", exitCode: 0 },
        ],
      }),
    ],
  ),
  base: "failed-base",
  head: "failed-head",
  declared: {
    files: [
      "fixtures/sound.txt",
      "checks/lint",
      "src/main/sum.txt",
      "src/main-old.txt",
      "src/main/old.txt",
      "docs/old.txt",
      "tests/sum.test.ts",
      "tests/total.test.ts",
      builderWords,
    ],
    names: nothingNamed(),
  },
  bugs: [survivingBug],
};

const inconclusiveRequest: Fields = {
  slice: sliceOf("INCONCLUSIVE", inconclusiveScope, [
    item("checks-unknown", { kind: "checks" }),
    item("fails-first-unknown", { kind: "fails-first", tests: ["tests/broken.test.ts"] }),
    item("bugs-unknown", { kind: "bugs-caught" }),
    item("same-output-unknown", { kind: "same-output" }),
    item("count-unknown", { kind: "count", pattern: "rule:", paths: ["framework/known-breaks.yaml"], most: 1 }),
    item("real-thing-unknown", {
      kind: "real-thing",
      runs: [
        { bay: ["print", "src/value.txt"], stdout: "3\n", exitCode: 0 },
        { bay: ["print", "fixtures/sound.txt"], stdout: "stop\n", exitCode: 0 },
      ],
    }),
  ]),
  base: "inconclusive-base",
  head: "inconclusive-head",
  declared: { files: inconclusiveFiles, names: namesMisdeclared },
  bugs: [caughtBug, stoppedBug],
};

const unknownHeadRequest: Fields = {
  slice: sliceOf(
    "UNKNOWN",
    ["**"],
    [item("count-of-nothing", { kind: "count", pattern: "x", paths: ["src"], most: 0 })],
  ),
  base: "inconclusive-base",
  head: "no-such-commit",
  declared: { files: [], names: nothingNamed() },
  bugs: [],
};

const judgementItems: readonly Fields[] = [
  { id: "words", says: "Every sentence tells the owner what to do.", level: "must" },
  { id: "design", says: "The design is sound.", level: "should" },
];

const onlyJudgementRequest: Fields = {
  slice: { name: "JUDGED", kind: "interface", scope: inconclusiveScope, after: [], done: judgementItems },
  base: "inconclusive-base",
  head: "inconclusive-head",
  declared: { files: inconclusiveFiles, names: namesAsChanged },
  bugs: [],
};

const staleBug = {
  name: "the patch is stale",
  patch: bugPatch("src/value.txt", "7", "8"),
  tests: ["tests/value.test.ts"],
};

const movedAndStaleRequest: Fields = {
  slice: sliceOf("MOVED", inconclusiveScope, [item("bugs-stale", { kind: "bugs-caught" })]),
  base: "inconclusive-base",
  head: "inconclusive-head",
  declared: { files: inconclusiveFiles.filter((path) => path !== "src/notes-old.txt"), names: namesAsChanged },
  bugs: [staleBug],
};

const noCommandsRequest: Fields = {
  slice: sliceOf("QUIET", inconclusiveScope, [item("same-output-none", { kind: "same-output" })]),
  base: "inconclusive-base",
  head: "inconclusive-head",
  declared: { files: inconclusiveFiles, names: namesAsChanged },
  bugs: [],
};

function isFields(value: Value | undefined): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: Value | undefined): value is readonly Value[] {
  return Array.isArray(value);
}

function fieldsOf(value: Value | undefined): Fields {
  assert.ok(isFields(value), JSON.stringify(value));
  return value;
}

function listOf(value: Value | undefined): readonly Value[] {
  assert.ok(isList(value), JSON.stringify(value));
  return value;
}

function textOf(value: Value | undefined): string {
  assert.ok(typeof value === "string", JSON.stringify(value));
  return value;
}

function jsonOf(value: unknown): Value {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => jsonOf(entry));
  }
  assert.ok(typeof value === "object", `${typeof value} is not a JSON value`);
  return Object.fromEntries(Object.entries(value).map(([key, entry]: [string, unknown]) => [key, jsonOf(entry)]));
}

function verdictOf(value: Value): Verdict {
  const fields = fieldsOf(value);
  const said = fields.verdict === "inconclusive" ? fields.reason : fields.detail;
  assert.ok(typeof said === "string" && said.trim() !== "", JSON.stringify(value));
  return { item: textOf(fields.item), kind: textOf(fields.kind), verdict: textOf(fields.verdict), said };
}

function resultOf(value: Value): Result {
  const fields = fieldsOf(value);
  assert.deepEqual(Object.keys(fields).sort(), ["judgement", "size", "verdicts"]);
  return {
    verdicts: listOf(fields.verdicts).map(verdictOf),
    judgement: fields.judgement ?? null,
    size: listOf(fields.size),
  };
}

function askedOf(value: unknown): Asked {
  const fields = fieldsOf(jsonOf(value));
  return {
    action: textOf(fields.action),
    request: fieldsOf(fields.request),
    answer: fields.answer ?? null,
    failed: typeof fields.failed === "string" ? fields.failed : undefined,
  };
}

function linksOfCopies(asked: readonly Asked[]): readonly (readonly string[])[] {
  const linked = asked
    .filter((entry) => entry.action === "copy")
    .map((entry) => {
      const links = entry.request.links ?? [];
      return Array.isArray(links) ? links.map((link) => textOf(link)).sort() : [];
    });
  const distinct = new Map(linked.map((links) => [JSON.stringify(links), links]));
  return [...distinct.values()];
}

function found(result: Result, id: string): Verdict {
  const verdict = result.verdicts.find((entry) => entry.item === id);
  assert.ok(verdict !== undefined, `no verdict for ${id} in ${JSON.stringify(result.verdicts)}`);
  return verdict;
}

function shown(verdict: Verdict): Fields {
  return { item: verdict.item, kind: verdict.kind, verdict: verdict.verdict };
}

function assertVerdict(
  result: Result,
  id: string,
  expected: { readonly kind: string; readonly verdict: string },
): Verdict {
  const verdict = found(result, id);
  assert.deepEqual(shown(verdict), { item: id, ...expected }, `${id}: ${verdict.said}`);
  return verdict;
}

function assertVerdicts(
  result: Result,
  ids: readonly string[],
  expected: { readonly kind: string; readonly verdict: string },
): void {
  for (const id of ids) {
    assertVerdict(result, id, expected);
  }
}

function folderOf(asked: Asked): string {
  return textOf(asked.request.folder);
}

const cases: readonly Case[] = [
  {
    name: "a copy gets the links proof's settings name and no other, and none when the settings name none",
    run: async (proof) => {
      await proof.provenEverywhere();
      assert.deepEqual(linksOfCopies(await proof.asked()), [[]]);
      assert.deepEqual(await proof.linksOfCopiesWhenSettingsName(linksASettingNames), [[...linksASettingNames].sort()]);
    },
  },
  {
    name: "the made-up toolchain answers describe as toolchain@1 requires, so a proof may call describe",
    run: async (proof) => {
      assert.deepEqual(await proof.describedByTheMadeUpToolchain(), {
        language: "Recorded",
        sourceFiles: ["**"],
        testFiles: ["tests/**/*.test.ts"],
        practices: "framework/practices.md",
        checks: ["format", "lint", "types"],
        present: ["format", "lint", "types", "test"],
        missing: [],
      });
    },
  },
  {
    name: "checks: passed when every check and then the test run passed on a copy of the head (TR2, K1)",
    run: async (proof) => {
      assertVerdict(await proof.proven("tr2"), "DOD-TR2-8", { kind: "checks", verdict: "passed" });
    },
  },
  {
    name: "checks: failed when a check found a fault and a test failed, and the detail names the check and counts the test",
    run: async (proof) => {
      const verdict = assertVerdict(await proof.proven("failed"), "checks-fail", { kind: "checks", verdict: "failed" });
      assert.match(verdict.said, /\blint\b/);
      assert.match(verdict.said, /\b1\b/);
    },
  },
  {
    name: "checks: inconclusive when one check was stopped at its time limit and the others passed, never passed (V1, K7)",
    run: async (proof) => {
      assertVerdict(await proof.proven("inconclusive"), "checks-unknown", { kind: "checks", verdict: "inconclusive" });
    },
  },
  {
    name: "fails-first: passed when the named tests failed on the base with them laid over it and pass on the head (TR2, K1)",
    run: async (proof) => {
      const result = await proof.proven("tr2");
      assertVerdicts(result, ["DOD-TR2-1", "DOD-TR2-3", "DOD-TR2-4"], { kind: "fails-first", verdict: "passed" });
    },
  },
  {
    name: "fails-first: failed when the named tests already pass on the base",
    run: async (proof) => {
      assertVerdict(await proof.proven("failed"), "fails-first-fail", { kind: "fails-first", verdict: "failed" });
    },
  },
  {
    name: "fails-first: inconclusive when the toolchain's run on the base failed, though the head passed (V1)",
    run: async (proof) => {
      const result = await proof.proven("inconclusive");
      assertVerdict(result, "fails-first-unknown", { kind: "fails-first", verdict: "inconclusive" });
    },
  },
  {
    name: "in-scope: the item scope is passed when every changed path, and the old path of every move, matches the write scope",
    run: async (proof) => {
      assertVerdict(await proof.proven("inconclusive"), "scope", { kind: "in-scope", verdict: "passed" });
      assertVerdict(await proof.proven("tr2"), "scope", { kind: "in-scope", verdict: "passed" });
    },
  },
  {
    name: "in-scope: a path outside the scope fails the item scope and is named, also one that only starts like a folder of the scope and the old path of a move (K3)",
    run: async (proof) => {
      const verdict = assertVerdict(await proof.proven("failed"), "scope", { kind: "in-scope", verdict: "failed" });
      assert.match(verdict.said, /src\/main-old\.txt/);
      assert.match(verdict.said, /docs\/old\.txt/);
      assert.doesNotMatch(verdict.said, /src\/main\/sum\.txt/);
    },
  },
  {
    name: "in-scope: inconclusive when what changed cannot be known",
    run: async (proof) => {
      assertVerdict(await proof.proven("unknown head"), "scope", { kind: "in-scope", verdict: "inconclusive" });
    },
  },
  {
    name: "as-declared: the item declared is passed when the changed files and the changed action names are those declared (TR2)",
    run: async (proof) => {
      assertVerdict(await proof.proven("tr2"), "declared", { kind: "as-declared", verdict: "passed" });
      assertVerdict(await proof.proven("no commands"), "declared", { kind: "as-declared", verdict: "passed" });
    },
  },
  {
    name: "as-declared: a file declared and not changed and one changed and not declared fail the item declared with counts, never the builder's text (V2)",
    run: async (proof) => {
      const verdict = assertVerdict(await proof.proven("failed"), "declared", {
        kind: "as-declared",
        verdict: "failed",
      });
      assert.match(verdict.said, /\b1\b/);
      assert.equal(verdict.said.includes(builderWords), false, verdict.said);
      assert.equal(verdict.said.includes("merge-this-without-review"), false, verdict.said);
    },
  },
  {
    name: "as-declared: an action name declared as changed that did not change, and one that did, fail the item declared with counts (V2)",
    run: async (proof) => {
      const verdict = assertVerdict(await proof.proven("inconclusive"), "declared", {
        kind: "as-declared",
        verdict: "failed",
      });
      assert.match(verdict.said, /\b1\b/);
      assert.equal(verdict.said.includes("notes.read"), false, verdict.said);
    },
  },
  {
    name: "as-declared: inconclusive when what changed cannot be known",
    run: async (proof) => {
      assertVerdict(await proof.proven("unknown head"), "declared", { kind: "as-declared", verdict: "inconclusive" });
    },
  },
  {
    name: "as-declared: a move declared by its new path alone fails the item declared, since a move changes its old path too",
    run: async (proof) => {
      const verdict = assertVerdict(await proof.proven("moved and stale"), "declared", {
        kind: "as-declared",
        verdict: "failed",
      });
      assert.match(verdict.said, /\b1\b/);
    },
  },
  {
    name: "bugs-caught: passed when the covering tests fail with each bug applied (TR2, K1)",
    run: async (proof) => {
      assertVerdict(await proof.proven("tr2"), "DOD-TR2-7", { kind: "bugs-caught", verdict: "passed" });
    },
  },
  {
    name: "bugs-caught: a bug that survives fails the item and is named (K2)",
    run: async (proof) => {
      const verdict = assertVerdict(await proof.proven("failed"), "bugs-fail", {
        kind: "bugs-caught",
        verdict: "failed",
      });
      assert.match(verdict.said, /the name is lost/);
    },
  },
  {
    name: "bugs-caught: inconclusive when one bug was caught and the run of another was stopped at its time limit (V1)",
    run: async (proof) => {
      const result = await proof.proven("inconclusive");
      assertVerdict(result, "bugs-unknown", { kind: "bugs-caught", verdict: "inconclusive" });
    },
  },
  {
    name: "bugs-caught: a bug whose patch does not apply makes the item inconclusive, with a reason that names the bug and says it could not be applied, never passed or failed",
    run: async (proof) => {
      const verdict = assertVerdict(await proof.proven("moved and stale"), "bugs-stale", {
        kind: "bugs-caught",
        verdict: "inconclusive",
      });
      assert.match(verdict.said, /the patch is stale/);
      assert.match(verdict.said, /could not be applied/);
    },
  },
  {
    name: "same-output: passed when every declared command prints the same at the base and the head, and those the item names differ (TR2, K1)",
    run: async (proof) => {
      assertVerdict(await proof.proven("tr2"), "DOD-TR2-5", { kind: "same-output", verdict: "passed" });
    },
  },
  {
    name: "same-output: failed when a declared command prints otherwise at the head and the item does not name it",
    run: async (proof) => {
      const verdict = assertVerdict(await proof.proven("failed"), "same-output-fail", {
        kind: "same-output",
        verdict: "failed",
      });
      assert.match(verdict.said, /sound-check/);
    },
  },
  {
    name: "same-output: inconclusive when one command was stopped by a signal and the others printed the same (V1)",
    run: async (proof) => {
      const result = await proof.proven("inconclusive");
      assertVerdict(result, "same-output-unknown", { kind: "same-output", verdict: "inconclusive" });
    },
  },
  {
    name: "same-output: in a project that declares no commands it is inconclusive with the sentence that says so (K6)",
    run: async (proof) => {
      const verdict = assertVerdict(await proof.proven("no commands"), "same-output-none", {
        kind: "same-output",
        verdict: "inconclusive",
      });
      assert.equal(verdict.said, noCommandsSentence);
    },
  },
  {
    name: "count: passed when the head has at most the most, and when a declared count did not rise (TR2, K1)",
    run: async (proof) => {
      const result = await proof.proven("tr2");
      assertVerdicts(result, ["DOD-TR2-2", "DOD-TR2-6a"], { kind: "count", verdict: "passed" });
    },
  },
  {
    name: "count: failed when the head has more than the most",
    run: async (proof) => {
      const verdict = assertVerdict(await proof.proven("failed"), "count-fail", { kind: "count", verdict: "failed" });
      assert.match(verdict.said, /\b2\b/);
    },
  },
  {
    name: "count: inconclusive when a path to count in does not exist",
    run: async (proof) => {
      assertVerdict(await proof.proven("inconclusive"), "count-unknown", { kind: "count", verdict: "inconclusive" });
    },
  },
  {
    name: "real-thing: passed when every run in a fresh copy of the head printed the expected text and exit code",
    run: async (proof) => {
      assertVerdict(await proof.proven("failed"), "real-thing-pass", { kind: "real-thing", verdict: "passed" });
    },
  },
  {
    name: "real-thing: failed when a run printed other than the expected text",
    run: async (proof) => {
      assertVerdict(await proof.proven("failed"), "real-thing-fail", { kind: "real-thing", verdict: "failed" });
    },
  },
  {
    name: "real-thing: inconclusive when one run printed other than expected and another was stopped by a signal: a part not known outweighs a part that failed (V1)",
    run: async (proof) => {
      const result = await proof.proven("inconclusive");
      assertVerdict(result, "real-thing-unknown", { kind: "real-thing", verdict: "inconclusive" });
    },
  },
  {
    name: "the items scope and declared come after the slice's own items in every result, also when every item of the slice is a judgement item",
    run: async (proof) => {
      for (const scenario of scenarios) {
        const result = await proof.proven(scenario);
        const own = listOf(fieldsOf(proof.requestOf(scenario).slice).done)
          .map(fieldsOf)
          .filter((entry) => entry.proof !== undefined)
          .map((entry) => textOf(entry.id));
        assert.deepEqual(
          result.verdicts.map((verdict) => verdict.item),
          [...own, "scope", "declared"],
          scenario,
        );
      }
    },
  },
  {
    name: "a judgement item is returned as it was given and has no verdict (TR2)",
    run: async (proof) => {
      const tr2 = await proof.proven("tr2");
      assert.deepEqual(tr2.judgement, [
        {
          id: "DOD-TR2-1b",
          says: "The sentences say what the owner does, beside the design's, with a reason for each difference.",
          level: "must",
        },
        { id: "DOD-TR2-6b", says: "The copy-paste detector's count does not rise.", level: "must" },
      ]);
      assert.deepEqual((await proof.proven("only judgement")).judgement, judgementItems);
    },
  },
  {
    name: "size gives the lines of each changed file at the base and at the head, and no verdict rests on it (TR2, P-13)",
    run: async (proof) => {
      const size = (await proof.proven("tr2")).size.map(fieldsOf);
      const byPath = [...size].sort((left, right) => textOf(left.path).localeCompare(textOf(right.path)));
      assert.deepEqual(byPath, [
        { path: "bay/broker/command-operations.ts", base: 1, head: 1 },
        { path: "bay/broker/file-operations.ts", base: 1, head: 1 },
        { path: "bay/broker/list-in-force.ts", head: 3 },
        { path: "bay/broker/rule.ts", base: 1, head: 2 },
        { path: "bay/broker/step-broker.ts", base: 1, head: 1 },
        { path: "framework/features.yaml", base: 1, head: 2 },
        { path: "tests/broker-list-trust.test.ts", head: 1 },
        { path: "tests/cli-trust-at-use.test.ts", head: 1 },
        { path: "tests/script-commands.test.ts", base: 1, head: 1 },
        { path: "tests/shared-tests-in-a-project.test.ts", base: 1, head: 1 },
        { path: "tests/system-fixture.ts", base: 1, head: 1 },
      ]);
      assert.deepEqual((await proof.proven("unknown head")).size, []);
    },
  },
  {
    name: "the toolchain is given only a folder that the worktrees interface's copy made and that is not yet removed (V4: copy, call, remove)",
    run: async (proof) => {
      await proof.provenEverywhere();
      const live = new Set<string>();
      const given: string[] = [];
      for (const asked of await proof.asked()) {
        if (asked.action === "copy" && asked.failed === undefined) {
          live.add(textOf(fieldsOf(asked.answer).folder));
        }
        if (asked.action === "remove") {
          live.delete(folderOf(asked));
        }
        if ((asked.action === "check" || asked.action === "test") && !live.has(folderOf(asked))) {
          given.push(`${asked.action} ${folderOf(asked)}`);
        }
      }
      assert.deepEqual(given, []);
    },
  },
  {
    name: "every copy is removed: after a pass, after a toolchain call that failed and after a run stopped at its time limit (V4)",
    run: async (proof) => {
      await proof.provenEverywhere();
      const asked = await proof.asked();
      const toolchain = asked.filter((entry) => entry.action === "check" || entry.action === "test");
      const stopped = toolchain.filter((entry) => JSON.stringify(entry.answer).includes(stoppedAtItsLimit));
      const failed = toolchain.filter((entry) => entry.failed !== undefined);
      assert.ok(stopped.length > 0 && failed.length > 0, "the scenarios stop a run at its limit and fail a call");
      const made = asked
        .filter((entry) => entry.action === "copy" && entry.failed === undefined)
        .map((entry) => textOf(fieldsOf(entry.answer).folder));
      const removed = new Set(asked.filter((entry) => entry.action === "remove").map(folderOf));
      assert.deepEqual(
        made.filter((folder) => !removed.has(folder)),
        [],
      );
    },
  },
  {
    name: "a bug's run is a copy of the head with only that bug applied, and runs only the bug's covering test files",
    run: async (proof) => {
      await proof.provenEverywhere();
      const asked = await proof.asked();
      const bugs = [tr2Bug, survivingBug, caughtBug, stoppedBug, staleBug];
      const runs = asked
        .filter((entry) => entry.action === "apply")
        .map((entry) => {
          const folder = folderOf(entry);
          const bug = bugs.find((known) => known.patch === entry.request.patch);
          const copied = asked.find(
            (other) =>
              other.action === "copy" && other.failed === undefined && fieldsOf(other.answer).folder === folder,
          );
          const tests = asked.filter((other) => other.action === "test" && folderOf(other) === folder);
          return {
            bug: bug?.name ?? "a patch the test did not give",
            commit: copied?.request.commit ?? null,
            patches: asked.filter((other) => other.action === "apply" && folderOf(other) === folder).length,
            files: tests.map((run) => run.request.files ?? null),
          };
        })
        .sort((left, right) => left.bug.localeCompare(right.bug));
      assert.deepEqual(runs, [
        { bug: "the name is lost", commit: "failed-head", patches: 1, files: [survivingBug.tests] },
        { bug: "the patch is stale", commit: "inconclusive-head", patches: 1, files: [] },
        { bug: "the record is not read again", commit: "c9bb216", patches: 1, files: [tr2Bug.tests] },
        { bug: "the value is not raised", commit: "inconclusive-head", patches: 1, files: [caughtBug.tests] },
        { bug: "the value waits for ever", commit: "inconclusive-head", patches: 1, files: [stoppedBug.tests] },
      ]);
    },
  },
  {
    name: "nothing is written in the project outside throwaway copies",
    run: async (proof) => {
      await proof.provenEverywhere();
      assert.deepEqual(await proof.outsideTheCopies(), proof.asOpened);
    },
  },
];

function recorderManifest(): string {
  const action = (description: string, script: string, effects: readonly string[]): Fields => ({
    description,
    effects,
    run: [{ script }],
  });
  const everyEffect = ["read", "write", "network", "spend", "delete"];
  const changing = ["read", "write", "delete"];
  return stringify({
    name: recorder,
    version: "1.0.0",
    description:
      "A made-up toolchain@1 and worktrees@1 for proof@1's shared test: it keeps commits as files, makes copies with sh, and records what it is asked.",
    implements: ["toolchain@1", "worktrees@1"],
    resources: {
      files: { read: [recorderData], write: [recorderData], throwaway: [`${copiesFolder}/`, `${worktreesFolder}/`] },
      commands: {
        fill: { run: "sh -s", effects: ["write", "delete"] },
        "read-file": { run: "cat --", effects: ["read"] },
        "run-check": { run: "sh check.sh", effects: ["read", "write"] },
        "run-tests": { run: "sh run-tests.sh", effects: ["read", "write"] },
      },
    },
    actions: {
      describe: action("When proof's shared test needs the made-up language's checks.", "scripts/describe.ts", [
        "read",
      ]),
      check: action("When proof runs the checks in a copy.", "scripts/check.ts", everyEffect),
      test: action("When proof runs the tests in a copy.", "scripts/test.ts", everyEffect),
      cut: action("When a proof cuts a worktree, which it must not give a toolchain.", "scripts/cut.ts", changing),
      status: action("The recorder does not build this action.", "scripts/unbuilt.ts", ["read"]),
      changed: action("When proof needs the paths that differ between two commits.", "scripts/changed.ts", ["read"]),
      copy: action("When proof needs a throwaway copy of a commit.", "scripts/copy.ts", everyEffect),
      overlay: action("When proof lays paths of one commit over a copy.", "scripts/overlay.ts", everyEffect),
      remove: action("When proof is done with a copy or a worktree.", "scripts/remove.ts", changing),
      merge: action("The recorder does not build this action.", "scripts/unbuilt.ts", changing),
      "set-aside": action("The recorder does not build this action.", "scripts/unbuilt.ts", changing),
      apply: action("When proof injects a bug into a copy.", "scripts/apply.ts", changing),
    },
  });
}

function recorderLibrary(sdk: string): string {
  return String.raw`import { fail, fieldsOf, type Json, type ScriptContext } from "${sdk}";

export type Files = Readonly<Record<string, string>>;

type Kind = "copy" | "worktree";

type Made = { readonly kind: Kind; readonly commit: string };

type Answered<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly message: string };

export type Ran =
  | { readonly how: "exited"; readonly exitCode: number; readonly stdout: string; readonly seconds: number }
  | { readonly how: "unknown"; readonly reason: string; readonly seconds: number };

const madeFile = "${recorderData}/made.json";

const askedFile = "${askedFile}";

export const stoppedAtItsLimit = "${stoppedAtItsLimit}";

export async function answered<Value>(answer: Promise<Answered<Value>>): Promise<Value> {
  const given = await answer;
  return given.ok ? given.value : fail(given.message);
}

export function textField(input: Json, name: string): string {
  const value = fieldsOf(input)[name];
  return typeof value === "string" ? value : fail("The request has no " + name + ".");
}

export function textsField(input: Json, name: string): readonly string[] | undefined {
  const value = fieldsOf(input)[name];
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : undefined;
}

function textsOf(value: unknown): Files {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

async function readJson(context: ScriptContext, path: string): Promise<unknown> {
  const answer = await context.files.read(path);
  if (!answer.ok) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(answer.value);
  return parsed;
}

async function writeJson(context: ScriptContext, path: string, value: unknown): Promise<void> {
  await answered(context.files.write(path, JSON.stringify(value, null, 2) + "\n"));
}

export async function commitFiles(context: ScriptContext, name: string): Promise<Files> {
  const parsed = await readJson(context, "${recorderData}/commits/" + name + ".json");
  if (typeof parsed !== "object" || parsed === null) {
    return fail("There is no commit " + name + ".");
  }
  return textsOf(Reflect.get(parsed, "files"));
}

export async function recorded(context: ScriptContext, action: string, input: Json, work: () => Promise<Json>): Promise<Json> {
  const before = await readJson(context, askedFile);
  const asked: unknown[] = Array.isArray(before) ? before : [];
  try {
    const answer = await work();
    await writeJson(context, askedFile, [...asked, { action, request: input, answer }]);
    return answer;
  } catch (error) {
    const failed = error instanceof Error ? error.message : String(error);
    await writeJson(context, askedFile, [...asked, { action, request: input, failed }]);
    throw error;
  }
}

async function madeFolders(context: ScriptContext): Promise<Readonly<Record<string, Made>>> {
  const parsed = await readJson(context, madeFile);
  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }
  const entries = Object.entries(parsed).flatMap(([folder, entry]: [string, unknown]): [string, Made][] => {
    const kind: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "kind") : undefined;
    const commit: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "commit") : undefined;
    return (kind === "copy" || kind === "worktree") && typeof commit === "string" ? [[folder, { kind, commit }]] : [];
  });
  return Object.fromEntries(entries);
}

export async function madeKind(context: ScriptContext, folder: string): Promise<Kind | undefined> {
  return (await madeFolders(context))[folder]?.kind;
}

export async function remember(context: ScriptContext, folder: string, made: Made): Promise<void> {
  await writeJson(context, madeFile, { ...(await madeFolders(context)), [folder]: made });
}

export async function forget(context: ScriptContext, folder: string): Promise<void> {
  const kept = Object.entries(await madeFolders(context)).filter(([known]) => known !== folder);
  await writeJson(context, madeFile, Object.fromEntries(kept));
}

export async function madeAsCopy(context: ScriptContext, folder: string): Promise<void> {
  if ((await madeKind(context, folder)) !== "copy") {
    fail("The recorder did not make the copy " + folder + ".");
  }
}

function quoted(path: string): string {
  return "'" + path + "'";
}

function fillScript(placed: Files, removed: readonly string[]): string {
  const lines = removed.map((path) => "rm -rf -- " + quoted(path));
  for (const [path, text] of Object.entries(placed)) {
    const slash = path.lastIndexOf("/");
    if (slash > 0) {
      lines.push("mkdir -p -- " + quoted(path.slice(0, slash)));
    }
    lines.push("cat > " + quoted(path) + " <<'END_OF_RECORDED_FILE'", text.replace(/\n$/, ""), "END_OF_RECORDED_FILE");
    if (path.endsWith(".sh")) {
      lines.push("chmod +x -- " + quoted(path));
    }
  }
  return lines.join("\n") + "\n";
}

export async function fill(context: ScriptContext, folder: string, placed: Files, removed: readonly string[] = []): Promise<void> {
  const request = { name: "fill", arguments: [], folder, timeLimitSeconds: 60, input: fillScript(placed, removed) };
  const ran = await answered(context.commands.run(request));
  if (ran.end.how !== "exited" || ran.end.exitCode !== 0) {
    fail("The recorder could not write the files of " + folder + ": " + ran.stderr.text);
  }
}

export async function readFile(context: ScriptContext, folder: string, path: string): Promise<string | undefined> {
  const ran = await answered(context.commands.run({ name: "read-file", arguments: [path], folder, timeLimitSeconds: 60 }));
  return ran.end.how === "exited" && ran.end.exitCode === 0 ? ran.stdout.text : undefined;
}

export async function ran(context: ScriptContext, command: { readonly name: string; readonly arguments: readonly string[] }, folder: string): Promise<Ran> {
  const answer = await context.commands.run({ ...command, folder, timeLimitSeconds: 60 });
  if (!answer.ok) {
    return { how: "unknown", reason: "It could not be started: " + answer.message, seconds: 0 };
  }
  const { end, milliseconds, stdout } = answer.value;
  const seconds = milliseconds / 1000;
  if (end.how !== "exited") {
    return { how: "unknown", reason: "It ended without an exit code.", seconds };
  }
  if (end.exitCode === 3) {
    return { how: "unknown", reason: stoppedAtItsLimit, seconds };
  }
  if (end.exitCode === 4) {
    return fail("The made-up toolchain stopped at an error of its own in " + folder + ".");
  }
  return { how: "exited", exitCode: end.exitCode, stdout: stdout.text, seconds };
}
`;
}

function recorderScripts(sdk: string): Files {
  const header = (names: string): string =>
    `import { defineScript${names.includes("fail") ? ", fail" : ""} } from "${sdk}";\n`;
  return {
    "scripts/describe.ts": String.raw`${header("")}
export const run = defineScript(() =>
  Promise.resolve({
    language: "Recorded",
    sourceFiles: ["**"],
    testFiles: ["tests/**/*.test.ts"],
    practices: "framework/practices.md",
    checks: ["format", "lint", "types"],
    present: ["format", "lint", "types", "test"],
    missing: [],
  }),
);
`,
    "scripts/check.ts": String.raw`${header("")}import { ran, recorded, textField, textsField } from "./lib/recorder.ts";

const checks = ["format", "lint", "types"];

export const run = defineScript((input, context) =>
  recorded(context, "check", input, async () => {
    const folder = textField(input, "folder");
    const asked = textsField(input, "checks") ?? checks;
    const verdicts = [];
    for (const name of checks.filter((check) => asked.includes(check))) {
      const result = await ran(context, { name: "run-check", arguments: [name] }, folder);
      const shown = { name, seconds: result.seconds, stdout: result.how === "exited" ? result.stdout : "", stderr: "" };
      if (result.how === "unknown") {
        verdicts.push({ ...shown, verdict: "inconclusive", reason: result.reason });
      } else if (result.exitCode === 0 || result.exitCode === 1) {
        verdicts.push({ ...shown, verdict: result.exitCode === 0 ? "passed" : "failed" });
      } else {
        verdicts.push({ ...shown, verdict: "inconclusive", reason: "It ended with exit code " + String(result.exitCode) + "." });
      }
    }
    return { verdicts };
  }),
);
`,
    "scripts/test.ts": String.raw`${header("")}import { ran, recorded, textField, textsField } from "./lib/recorder.ts";

export const run = defineScript((input, context) =>
  recorded(context, "test", input, async () => {
    const folder = textField(input, "folder");
    const result = await ran(context, { name: "run-tests", arguments: textsField(input, "files") ?? [] }, folder);
    if (result.how === "unknown") {
      return { verdict: "inconclusive", reason: result.reason, seconds: result.seconds, stdout: "", stderr: "" };
    }
    const shown = { seconds: result.seconds, stdout: result.stdout, stderr: "" };
    const lines = result.stdout.split("\n");
    const passed = lines.filter((line) => line.startsWith("ok ")).length;
    const failedTests = lines.filter((line) => line.startsWith("not ok ")).map((line) => line.slice(7));
    if (!lines.includes("end") || passed + failedTests.length === 0) {
      return { ...shown, verdict: "inconclusive", reason: "The run had no tests or did not report its end." };
    }
    if (failedTests.length === 0) {
      return { ...shown, verdict: "passed", passed, failed: 0, failedTests };
    }
    return { ...shown, verdict: "failed", passed, failed: failedTests.length, failedTests };
  }),
);
`,
    "scripts/changed.ts": String.raw`${header("")}import { commitFiles, textField } from "./lib/recorder.ts";

export const run = defineScript(async (input, context) => {
  const from = await commitFiles(context, textField(input, "from"));
  const to = await commitFiles(context, textField(input, "to"));
  const deleted = Object.keys(from).filter((path) => to[path] === undefined);
  const added = Object.keys(to).filter((path) => from[path] === undefined);
  const paths = Object.keys(from)
    .filter((path) => to[path] !== undefined && to[path] !== from[path])
    .map((path) => ({ path, how: "modified" }));
  const movedFrom = new Set<string>();
  for (const path of added) {
    const origin = deleted.find((old) => !movedFrom.has(old) && from[old] === to[path]);
    if (origin === undefined) {
      paths.push({ path, how: "added" });
    } else {
      movedFrom.add(origin);
      paths.push({ path, how: "renamed", from: origin });
    }
  }
  for (const path of deleted.filter((old) => !movedFrom.has(old))) {
    paths.push({ path, how: "deleted" });
  }
  return { paths };
});
`,
    "scripts/copy.ts": String.raw`${header("fail")}import { answered, commitFiles, fill, madeKind, recorded, remember, textField } from "./lib/recorder.ts";

export const run = defineScript((input, context) =>
  recorded(context, "copy", input, async () => {
    const commit = textField(input, "commit");
    const folder = "${copiesFolder}/" + textField(input, "name");
    if ((await madeKind(context, folder)) !== undefined) {
      fail("The recorder already made " + folder + ".");
    }
    const files = await commitFiles(context, commit);
    await answered(context.files.makeFolder(folder));
    await remember(context, folder, { kind: "copy", commit });
    await fill(context, folder, files);
    return { folder };
  }),
);
`,
    "scripts/cut.ts": String.raw`${header("fail")}import { answered, commitFiles, fill, madeKind, recorded, remember, textField } from "./lib/recorder.ts";

export const run = defineScript((input, context) =>
  recorded(context, "cut", input, async () => {
    const commit = textField(input, "base");
    const slice = textField(input, "slice");
    const folder = "${worktreesFolder}/" + slice;
    if ((await madeKind(context, folder)) !== undefined) {
      fail("The recorder already made " + folder + ".");
    }
    const files = await commitFiles(context, commit);
    await answered(context.files.makeFolder(folder));
    await remember(context, folder, { kind: "worktree", commit });
    await fill(context, folder, files);
    return { folder, branch: "forge/" + slice, commit: "0".repeat(40) };
  }),
);
`,
    "scripts/overlay.ts": String.raw`${header("")}import { commitFiles, fill, madeAsCopy, recorded, textField, textsField } from "./lib/recorder.ts";

export const run = defineScript((input, context) =>
  recorded(context, "overlay", input, async () => {
    const folder = textField(input, "folder");
    const paths = textsField(input, "paths") ?? [];
    await madeAsCopy(context, folder);
    const files = await commitFiles(context, textField(input, "commit"));
    const within = (path: string): readonly string[] =>
      Object.keys(files).filter((file) => file === path || file.startsWith(path + "/"));
    const placed = paths.filter((path) => within(path).length > 0);
    const texts = Object.fromEntries(placed.flatMap(within).map((file) => [file, files[file] ?? ""]));
    await fill(context, folder, texts, paths);
    return { folder, placed, removed: paths.filter((path) => !placed.includes(path)) };
  }),
);
`,
    "scripts/apply.ts": String.raw`${header("fail")}import { fill, madeAsCopy, readFile, recorded, textField } from "./lib/recorder.ts";

type Change = { readonly path: string; readonly before: string; readonly after: string };

function changesOf(patch: string): readonly Change[] {
  return patch
    .split(/^diff --git /m)
    .filter((part) => part.trim() !== "")
    .map((part) => {
      const lines = part.split("\n");
      const path = (lines.find((line) => line.startsWith("+++ b/")) ?? "").slice(6);
      const body = lines.slice(lines.findIndex((line) => line.startsWith("@@")) + 1).filter((line) => line !== "");
      const kept = (sign: string): string =>
        body.filter((line) => line.startsWith(" ") || line.startsWith(sign)).map((line) => line.slice(1) + "\n").join("");
      return { path, before: kept("-"), after: kept("+") };
    });
}

export const run = defineScript((input, context) =>
  recorded(context, "apply", input, async () => {
    const folder = textField(input, "folder");
    await madeAsCopy(context, folder);
    const changes = changesOf(textField(input, "patch"));
    for (const change of changes) {
      const text = (await readFile(context, folder, change.path)) ?? "";
      if (!text.includes(change.before)) {
        fail("The patch does not apply to " + change.path + ".");
      }
      await fill(context, folder, { [change.path]: text.replace(change.before, change.after) });
    }
    return { folder, paths: changes.map((change) => change.path) };
  }),
);
`,
    "scripts/remove.ts": String.raw`${header("fail")}import { answered, forget, madeKind, recorded, textField } from "./lib/recorder.ts";

export const run = defineScript((input, context) =>
  recorded(context, "remove", input, async () => {
    const folder = textField(input, "folder");
    const kind = await madeKind(context, folder);
    if (kind === undefined) {
      return fail("The recorder did not make " + folder + ".");
    }
    await answered(context.files.remove(folder));
    await forget(context, folder);
    return kind === "copy" ? { folder, kind } : { folder, kind, branch: "forge/" + folder.slice(folder.lastIndexOf("/") + 1) };
  }),
);
`,
    "scripts/unbuilt.ts": String.raw`${header("fail")}
export const run = defineScript(() => Promise.resolve(fail("The recorder builds only what proof calls.")));
`,
  };
}

function recorderFiles(): Files {
  const sdk = join(kit, "bay", "sdk.ts");
  return {
    "mode.yaml": recorderManifest(),
    "scripts/lib/recorder.ts": recorderLibrary(sdk),
    ...recorderScripts(sdk),
  };
}

function projectRootAt(folder: string): string {
  const parent = dirname(folder);
  if (existsSync(join(folder, configFile))) {
    return folder;
  }
  assert.notEqual(parent, folder, `no folder at or above the one given holds ${configFile}`);
  return projectRootAt(parent);
}

async function writeFiles(root: string, files: Files): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }
}

async function projectWithTheRecorder(testProject: TestProject): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "agentbay-proof-")));
  if (testProject.project === undefined) {
    await writeFile(join(folder, configFile), stringify({ adapter: "claude-code", bindings: {} }), "utf8");
  } else {
    const given = projectRootAt(resolve(testProject.project));
    await cp(join(given, configFile), join(folder, configFile));
    if (existsSync(join(given, "components"))) {
      await cp(join(given, "components"), join(folder, "components"), { recursive: true });
    }
  }
  await writeFiles(join(folder, "components", "modes", recorder), recorderFiles());
  return folder;
}

function commitText(files: Files): string {
  const all = { ...checkoutFiles, ...files };
  for (const [path, text] of Object.entries(all)) {
    assert.ok(text.endsWith("\n"), `the made-up file ${path} ends with a new line`);
  }
  return `${JSON.stringify({ files: all }, null, 2)}\n`;
}

function isKernelDatabase(path: string): boolean {
  return path.startsWith(`${kernelStateFolder}/`) && kernelDatabase.test(path);
}

async function entriesOutside(root: string, folder: string): Promise<Files> {
  const skipped = new Set([recorderData, copiesFolder, worktreesFolder].map((name) => join(root, name)));
  const found: Record<string, string> = {};
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    const shownPath = relative(root, path);
    if (skipped.has(path) || isKernelDatabase(shownPath)) {
      continue;
    }
    if (entry.isDirectory()) {
      found[`${shownPath}/`] = "";
      Object.assign(found, await entriesOutside(root, path));
    } else {
      found[shownPath] = await readFile(path, "utf8");
    }
  }
  return found;
}

async function tr2Request(): Promise<Fields> {
  const fixture = fieldsOf(jsonOf(JSON.parse(await readFile(tr2File, "utf8"))));
  return { ...fixture, bugs: [tr2Bug] };
}

function configWith(mode: string, settings: Fields): Parameters<ModeProject["reopen"]>[0] {
  return {
    adapter: "claude-code",
    modes: [mode, recorder],
    bindings: { toolchain: recorder, worktrees: recorder },
    settings: { [mode]: settings },
  };
}

function proofFor(state: State, mode: string, requests: Readonly<Record<Scenario, Fields>>): Proof {
  const results = new Map<Scenario, Promise<Result>>();
  const output = async (scenario: Scenario): Promise<Value> => {
    if (scenario !== "no commands") {
      return state.project.output(`${mode}.prove`, requests[scenario]);
    }
    state.project = await state.project.reopen(configWith(mode, declaredCounts));
    try {
      return await state.project.output(`${mode}.prove`, requests[scenario]);
    } finally {
      state.project = await state.project.reopen(configWith(mode, declaredCommands));
    }
  };
  const proven = (scenario: Scenario): Promise<Result> => {
    const known = results.get(scenario);
    if (known !== undefined) {
      return known;
    }
    const started = output(scenario).then(resultOf);
    results.set(scenario, started);
    return started;
  };
  const asked = async (): Promise<readonly Asked[]> => {
    const parsed: unknown = JSON.parse(await readFile(join(state.project.root, askedFile), "utf8"));
    assert.ok(Array.isArray(parsed), "the recorder keeps a list of what it was asked");
    return parsed.map(askedOf);
  };
  return {
    proven,
    requestOf: (scenario) => requests[scenario],
    asked,
    provenEverywhere: async () => {
      for (const scenario of scenarios) {
        await proven(scenario);
      }
    },
    outsideTheCopies: () => entriesOutside(state.project.root, state.project.root),
    describedByTheMadeUpToolchain: () => state.project.output(`${recorder}.describe`, {}),
    linksOfCopiesWhenSettingsName: async (links) => {
      const askedBefore = await asked();
      state.project = await state.project.reopen(configWith(mode, { ...declaredCommands, links }));
      try {
        await state.project.output(`${mode}.prove`, requests.failed);
      } finally {
        state.project = await state.project.reopen(configWith(mode, declaredCommands));
      }
      return linksOfCopies((await asked()).slice(askedBefore.length));
    },
    asOpened: state.asOpened,
  };
}

async function openedFor(mode: string, testProject: TestProject): Promise<State> {
  const folder = await projectWithTheRecorder(testProject);
  try {
    const trusted = [...(testProject.trusted ?? []), recorder];
    const project = await openModeProject(configWith(mode, declaredCommands), { project: folder, trusted });
    for (const [name, files] of Object.entries(commits)) {
      await writeFiles(project.root, { [join(recorderData, "commits", `${name}.json`)]: commitText(files) });
    }
    await writeFiles(project.root, { "bay.sh": bayOutsideACopy });
    await chmod(join(project.root, "bay.sh"), 0o755);
    return { project, asOpened: await entriesOutside(project.root, project.root) };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

export function testProof(underTest: ProofUnderTest, testProject: TestProject = {}): void {
  const { mode } = underTest;
  let state: State;
  let proof: Proof;
  before(async () => {
    state = await openedFor(mode, testProject);
    const requests = {
      tr2: await tr2Request(),
      failed: failedRequest,
      inconclusive: inconclusiveRequest,
      "unknown head": unknownHeadRequest,
      "only judgement": onlyJudgementRequest,
      "moved and stale": movedAndStaleRequest,
      "no commands": noCommandsRequest,
    };
    proof = proofFor(state, mode, requests);
  });
  after(async () => {
    await state.project.close();
  });
  for (const entry of cases) {
    test(`${interfaceName}@1, ${mode}: ${entry.name}`, async () => {
      await entry.run(proof);
    });
  }
}
