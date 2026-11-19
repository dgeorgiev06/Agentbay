import { stringify } from "yaml";

import type { ModeFiles } from "./kit-copy.ts";

export type TallyVariant =
  | "stops a check at its limit"
  | "passes a check stopped at its limit"
  | "writes its build output beside the folder"
  | "writes its build output in the project's root"
  | "writes its build output in the kernel's state folder"
  | "builds only into a folder with no build output"
  | "passes a check the checkout is not set up for"
  | "says the project lacks nothing"
  | "names a file that did not load as a failing case"
  | "answers a command stopped at its limit as ended";

export const tally = "tally";

export const wrongTally = "tally-wrong";

export const besideTally = "tally-beside";

export const rootTally = "tally-root";

export const kernelStateTally = "tally-kernel-state";

export const onceTally = "tally-once";

export const notSetUpTally = "tally-not-set-up";

export const lacksNothingTally = "tally-lacks-nothing";

export const unloadedAsCaseTally = "tally-unloaded-as-case";

export const stoppedAsEndedTally = "tally-stopped-as-ended";

const sdkFromScripts = "../../../../bay/sdk.ts";

const sdkFromLibrary = "../../../../../bay/sdk.ts";

const checkNames = ["spelling", "line-length", "build"];

const buildCommands: Readonly<Record<TallyVariant, string>> = {
  "stops a check at its limit": "sh build.sh build -p",
  "passes a check stopped at its limit": "sh build.sh build -p",
  "writes its build output beside the folder": "sh build.sh ../build -p",
  "writes its build output in the project's root": "sh build.sh ../../build -p",
  "writes its build output in the kernel's state folder": "sh build.sh ../../.agentbay/build -p",
  "builds only into a folder with no build output": "sh build.sh build",
  "passes a check the checkout is not set up for": "sh build.sh build -p",
  "says the project lacks nothing": "sh build.sh build -p",
  "names a file that did not load as a failing case": "sh build.sh build -p",
  "answers a command stopped at its limit as ended": "sh build.sh build -p",
};

const effectsOfARun = ["read", "write", "network", "spend", "delete"];

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function lines(...texts: readonly string[]): string {
  return `${texts.join("\n")}\n`;
}

function everyEffectOf(run: string): object {
  return { run, effects: effectsOfARun };
}

function manifestOf(name: string, variant: TallyVariant): string {
  const action = (description: string, script: string, effects: readonly string[]): object => ({
    description,
    effects,
    run: [{ script }],
  });
  return stringify({
    name,
    version: "1.0.0",
    description: "Checks and tests Tally, a made-up language; a toolchain@1 that a test adds to a copy of the kit.",
    implements: ["toolchain@1"],
    resources: {
      files: { read: ["checks/", "run-tests.sh"] },
      commands: {
        "has-file": { run: "test -f", effects: ["read"] },
        "check-spelling": everyEffectOf("sh checks/spelling.sh"),
        "check-line-length": everyEffectOf("sh checks/line-length.sh"),
        "check-build": everyEffectOf(buildCommands[variant]),
        "run-tests": everyEffectOf("sh run-tests.sh"),
        "run-command": everyEffectOf("sh"),
      },
    },
    extraFiles: ["practices.md"],
    actions: {
      describe: action("When a test needs Tally's files, practices and checks.", "scripts/describe.ts", ["read"]),
      check: action("When a test needs Tally's checks run in a checkout.", "scripts/check.ts", effectsOfARun),
      test: action("When a test needs Tally's tests run in a checkout.", "scripts/run-tests.ts", effectsOfARun),
      run: action("When a test needs one of a checkout's commands run.", "scripts/run.ts", effectsOfARun),
    },
  });
}

const stoppedLine = '      return { ...shown, ending: { kind: "unknown", reason: stoppedReason(limit) } };';

const passedWhenStoppedLine = '      return { ...shown, ending: { kind: "exited", exitCode: 0 } };';

const failingLine = '  const failing = reported.filter((line) => line.startsWith("not ok ")).map(failingCaseOf);';

const failingWithUnloadedLine =
  '  const failing = [...reported.filter((line) => line.startsWith("not ok ")).map(failingCaseOf), ...notLoaded.map(unloadedAsCase)];';

const notSetUpLine = '  return { ...notRun, verdict: "inconclusive", reason };';

const passedWhenNotSetUpLine = '  return { ...notRun, verdict: "passed" };';

const library = String.raw`import { fieldsOf, type Json, type ScriptContext } from "${sdkFromLibrary}";

export const checks: readonly string[] = ${JSON.stringify(checkNames)};

type Shown = { readonly seconds: number; readonly stdout: string; readonly stderr: string };

type Ending =
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "unknown"; readonly reason: string };

type Ran = Shown & { readonly ending: Ending };

export type Request = {
  readonly folder: string;
  readonly names: readonly string[] | undefined;
  readonly timeLimitSeconds: number;
};

type Verdict =
  | (Shown & { readonly verdict: "passed" | "failed" })
  | (Shown & { readonly verdict: "inconclusive"; readonly reason: string });

export type Asked = { readonly namesField: string; readonly defaultSeconds: number };

export function requestOf(input: Json, asked: Asked): Request {
  const fields = fieldsOf(input);
  const names = fields[asked.namesField];
  const seconds = fields.timeLimitSeconds;
  return {
    folder: typeof fields.folder === "string" ? fields.folder : "",
    names: Array.isArray(names) ? names.filter((name) => typeof name === "string") : undefined,
    timeLimitSeconds: typeof seconds === "number" ? seconds : asked.defaultSeconds,
  };
}

export function fileOfCheck(name: string): string {
  return "checks/" + name + ".sh";
}

export const testRunFile = "run-tests.sh";

export function lacking(place: string, file: string): string {
  return place + " has no " + file + ": add it, so that Tally can run it.";
}

export type SetUp =
  | { readonly kind: "set up" }
  | { readonly kind: "not set up"; readonly reason: string }
  | { readonly kind: "unknown"; readonly reason: string };

function stoppedReason(limit: number): string {
  return "It did not finish within " + String(limit) + " seconds and was stopped.";
}

export type Named = { readonly name: string; readonly arguments: readonly string[] };

export async function ran(context: ScriptContext, named: Named, request: Request): Promise<Ran> {
  const limit = request.timeLimitSeconds;
  const answer = await context.commands.run({ ...named, folder: request.folder, timeLimitSeconds: limit });
  if (!answer.ok) {
    const reason = "It could not be started: " + answer.message;
    return { seconds: 0, stdout: "", stderr: "", ending: { kind: "unknown", reason } };
  }
  const { end, milliseconds, stdout, stderr } = answer.value;
  const shown = { seconds: milliseconds / 1000, stdout: stdout.text, stderr: stderr.text };
  switch (end.how) {
    case "exited":
      return { ...shown, ending: { kind: "exited", exitCode: end.exitCode } };
    case "timed-out":
${stoppedLine}
    case "signalled":
      return { ...shown, ending: { kind: "unknown", reason: "It was stopped by the signal " + end.signal + "." } };
  }
}

export async function setUpFor(context: ScriptContext, file: string, request: Request): Promise<SetUp> {
  const found = await ran(context, { name: "has-file", arguments: [file] }, request);
  if (found.ending.kind === "unknown") {
    return found.ending;
  }
  return found.ending.exitCode === 0 ? { kind: "set up" } : { kind: "not set up", reason: lacking("The checkout", file) };
}

export function notSetUpVerdict(name: string, reason: string): Json {
  const notRun = { name, seconds: 0, stdout: "", stderr: "" };
${notSetUpLine}
}

export function unknownVerdict(name: string, reason: string): Json {
  return { name, seconds: 0, stdout: "", stderr: "", verdict: "inconclusive", reason };
}

export function checkVerdict(name: string, result: Ran): Json {
  const shown = { name, seconds: result.seconds, stdout: result.stdout, stderr: result.stderr };
  if (result.ending.kind === "unknown") {
    return { ...shown, verdict: "inconclusive", reason: result.ending.reason };
  }
  const code = result.ending.exitCode;
  if (code === 0 || code === 1) {
    return { ...shown, verdict: code === 0 ? "passed" : "failed" };
  }
  return { ...shown, verdict: "inconclusive", reason: "It ended with exit code " + String(code) + "." };
}

const longestMessage = 200;

const mostFailures = 50;

type FailingCase = { readonly name: string; readonly file: string; readonly message: string; readonly charactersCut: number };

function failingCaseOf(line: string): FailingCase {
  const [file = "", name = "", ...rest] = line.slice("not ok ".length).split("|");
  const lines = rest.join("|").split("\\n").map((part) => part.trim());
  const characters = Array.from(lines.find((part) => part !== "") ?? "");
  const message = characters.slice(0, longestMessage).join("");
  return { name, file, message, charactersCut: Math.max(0, characters.length - longestMessage) };
}

function unloadedAsCase(file: string): FailingCase {
  return { name: file, file, message: "", charactersCut: 0 };
}

export function testResult(result: Ran): Json {
  const shown = { seconds: result.seconds, stdout: result.stdout, stderr: result.stderr };
  const unknown = (reason: string): Json => ({ ...shown, verdict: "inconclusive", reason });
  if (result.ending.kind === "unknown") {
    return unknown(result.ending.reason);
  }
  const reported = result.stdout.split("\n");
  const passed = reported.filter((line) => line.startsWith("ok ")).length;
  const notLoaded = reported.filter((line) => line.startsWith("not loaded ")).map((line) => line.slice(11));
${failingLine}
  const failedTests = [...failing.map((failure) => failure.name), ...notLoaded];
  if (!reported.includes("end")) {
    return unknown("The run did not report its end.");
  }
  if (passed + failedTests.length === 0) {
    return unknown("The run had no tests.");
  }
  const code = result.ending.exitCode;
  if (code === 0 && failedTests.length === 0) {
    return { ...shown, passed, failed: 0, failedTests, verdict: "passed" };
  }
  if (code === 1 && failedTests.length > 0) {
    const cases = {
      failures: failing.slice(0, mostFailures),
      failuresNotListed: Math.max(0, failing.length - mostFailures),
      notLoaded,
    };
    return { ...shown, passed, failed: failedTests.length, failedTests, ...cases, verdict: "failed" };
  }
  return unknown("The run ended with exit code " + String(code) + ".");
}
`;

const missingLine = '      missing.push({ name, reason: lacking("The project", file) });';

const describeScript = lines(
  `import { defineScript } from "${sdkFromScripts}";`,
  'import { checks, fileOfCheck, lacking, testRunFile } from "./lib/tally.ts";',
  "",
  'const files = [...checks.map((name) => ({ name, file: fileOfCheck(name) })), { name: "test", file: testRunFile }];',
  "",
  "export const run = defineScript(async (_input, context) => {",
  "  const present = [];",
  "  const missing = [];",
  "  for (const { name, file } of files) {",
  "    const read = await context.files.read(file);",
  "    if (read.ok) {",
  "      present.push(name);",
  "    } else {",
  missingLine,
  "    }",
  "  }",
  "  return {",
  '    language: "Tally",',
  '    sourceFiles: ["**/*.tally"],',
  '    testFiles: ["tests/**/*.test.tally"],',
  '    practices: "practices.md",',
  "    checks: [...checks],",
  "    present,",
  "    missing,",
  "  };",
  "});",
);

const checkScript = lines(
  `import { defineScript, fail } from "${sdkFromScripts}";`,
  "import {",
  "  checks,",
  "  checkVerdict,",
  "  fileOfCheck,",
  "  notSetUpVerdict,",
  "  ran,",
  "  requestOf,",
  "  setUpFor,",
  "  unknownVerdict,",
  '} from "./lib/tally.ts";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const request = requestOf(input, { namesField: "checks", defaultSeconds: 90 });',
  "  const asked = request.names ?? checks;",
  "  const unknown = asked.filter((name) => !checks.includes(name));",
  "  if (unknown.length > 0) {",
  '    fail("Tally has no check named " + unknown.join(" or ") + ".");',
  "  }",
  "  const verdicts = [];",
  "  for (const name of checks.filter((check) => asked.includes(check))) {",
  "    const setUp = await setUpFor(context, fileOfCheck(name), request);",
  '    if (setUp.kind === "set up") {',
  '      verdicts.push(checkVerdict(name, await ran(context, { name: "check-" + name, arguments: [] }, request)));',
  '    } else if (setUp.kind === "not set up") {',
  "      verdicts.push(notSetUpVerdict(name, setUp.reason));",
  "    } else {",
  "      verdicts.push(unknownVerdict(name, setUp.reason));",
  "    }",
  "  }",
  "  return { verdicts };",
  "});",
);

const testScript = lines(
  `import { defineScript } from "${sdkFromScripts}";`,
  'import { ran, requestOf, setUpFor, testResult, testRunFile } from "./lib/tally.ts";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const request = requestOf(input, { namesField: "files", defaultSeconds: 420 });',
  "  const setUp = await setUpFor(context, testRunFile, request);",
  '  if (setUp.kind !== "set up") {',
  '    return { seconds: 0, stdout: "", stderr: "", verdict: "inconclusive", reason: setUp.reason };',
  "  }",
  '  return testResult(await ran(context, { name: "run-tests", arguments: request.names ?? [] }, request));',
  "});",
);

const stoppedRunLine =
  '      return { ended: "timed-out", reason: "It did not finish within " + limit + " seconds and was stopped.", ...shown };';

const endedWhenStoppedRunLine = '      return { ended: "exited", exitCode: 0, ...shown };';

const runScript = lines(
  `import { defineScript, fieldsOf } from "${sdkFromScripts}";`,
  'import { requestOf, setUpFor } from "./lib/tally.ts";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const request = requestOf(input, { namesField: "arguments", defaultSeconds: 90 });',
  "  const name = fieldsOf(input).name;",
  '  const file = "commands/" + (typeof name === "string" ? name : "") + ".sh";',
  "  const setUp = await setUpFor(context, file, request);",
  '  if (setUp.kind !== "set up") {',
  '    return { ended: setUp.kind === "unknown" ? "not started" : "not set up", reason: setUp.reason, seconds: 0 };',
  "  }",
  "  const limit = String(request.timeLimitSeconds);",
  "  const answer = await context.commands.run({",
  '    name: "run-command",',
  "    arguments: [file, ...(request.names ?? [])],",
  "    folder: request.folder,",
  "    timeLimitSeconds: request.timeLimitSeconds,",
  "  });",
  "  if (!answer.ok) {",
  '    return { ended: "not started", reason: "It could not be started: " + answer.message, seconds: 0 };',
  "  }",
  "  const { end, milliseconds, stdout } = answer.value;",
  "  const shown = { seconds: milliseconds / 1000, stdout: stdout.text, stdoutCut: stdout.cut };",
  "  switch (end.how) {",
  '    case "exited":',
  '      return { ended: "exited", exitCode: end.exitCode, ...shown };',
  '    case "timed-out":',
  stoppedRunLine,
  '    case "signalled":',
  '      return { ended: "signalled", signal: end.signal, reason: "It was stopped by the signal " + end.signal + ".", ...shown };',
  "  }",
  "});",
);

const checkoutFunction = String.raw`import type {
  Files,
  Outcome,
  Wanted,
  WantedCheck,
  WantedCommand,
  WantedTest,
  WantedTestFile,
} from "../../interfaces/toolchain/tests/shared.ts";

const checkBodies: Readonly<Record<Outcome, string>> = {
  passes: "",
  fails: "exit 1",
  "does not end": "sleep 600",
};


const builder = [
  'out="$1"',
  "shift",
  'mkdir "$@" "$out" || exit 1',
  'echo "built from src/main.tally" > "$out/$(basename "$PWD").out"',
  "exec sh checks/build.sh",
  "",
].join("\n");

const runner = [
  'if [ "$#" -eq 0 ]; then set -- $(find tests -name "*.test.tally" 2>/dev/null | sort); fi',
  "status=0",
  'for file in "$@"; do',
  "  while IFS= read -r line; do",
  '    case "$line" in',
  '      "break") echo "not loaded $file"; status=1; break ;;',
  '      "pass "*) echo "ok ${"$"}{line#pass }" ;;',
  '      "fail "*) printf "%s\\n" "not ok $file|${"$"}{line#fail }"; status=1 ;;',
  '      "hang "*) sleep 600 ;;',
  "    esac",
  '  done < "$file"',
  "done",
  'echo "end"',
  "exit $status",
  "",
].join("\n");

function checkScriptOf(check: WantedCheck, outcome: Outcome): string {
  return ["echo " + JSON.stringify(check.line), checkBodies[outcome], ""].join("\n");
}

function testLineOf(test: WantedTest): string {
  switch (test.outcome) {
    case "passes":
      return "pass " + test.name;
    case "fails":
      return "fail " + test.name + "|" + test.message.split("\n").join("\\n");
    case "does not end":
      return "hang " + test.name;
  }
}

function testFileOf(file: WantedTestFile): string {
  if (file === "does not load") {
    return "break\npass never runs\n";
  }
  return [...file.map(testLineOf), ""].join("\n");
}

function quoted(text: string): string {
  return "'" + text.split("'").join("'\\''") + "'";
}

function commandScriptOf(command: WantedCommand): string {
  const print = "printf '%s\\n' " + quoted(command.line);
  if (command.outcome === "does not end") {
    return [print, "sleep 600", ""].join("\n");
  }
  return [
    "printed=0",
    "while [ $printed -lt " + String(command.times) + " ]; do",
    "  " + print,
    "  printed=$((printed + 1))",
    "done",
    'for word in "$@"; do',
    "  printf '%s\\n' \"$word\"",
    "done",
    "exit " + String(command.exitCode),
    "",
  ].join("\n");
}

export function tallyCheckout(wanted: Wanted): Files {
  const commands = wanted.commands.map((command) => ["commands/" + command.name + ".sh", commandScriptOf(command)]);
  const checks = wanted.checks.flatMap((check) => {
    const outcome = check.outcome;
    return outcome === "not set up" ? [] : [["checks/" + check.name + ".sh", checkScriptOf(check, outcome)]];
  });
  const runners = wanted.testRun === "set up" ? { "run-tests.sh": runner } : {};
  const tests = wanted.testFiles.map((file, index) => [
    "tests/file-" + String(index + 1) + ".test.tally",
    testFileOf(file),
  ]);
  return {
    "build.sh": builder,
    ...runners,
    "src/main.tally": "pass the source\n",
    ...Object.fromEntries(checks),
    ...Object.fromEntries(tests),
    ...Object.fromEntries(commands),
  };
}
`;

function modeTest(name: string): string {
  return lines(
    'import { testToolchain } from "../../interfaces/toolchain/tests/shared.ts";',
    'import { tallyCheckout } from "./checkout.ts";',
    "",
    `testToolchain({ mode: "${name}", checkout: tallyCheckout });`,
  );
}

const examples = {
  describe: {
    input: {},
    output: {
      language: "Tally",
      sourceFiles: ["**/*.tally"],
      testFiles: ["tests/**/*.test.tally"],
      practices: "practices.md",
      checks: checkNames,
      present: ["spelling", "line-length", "build"],
      missing: [{ name: "test", reason: "The project has no run-tests.sh: add it, so that Tally can run it." }],
    },
  },
  check: {
    input: { folder: "work/checkout", checks: ["spelling"] },
    output: { verdicts: [{ name: "spelling", verdict: "passed", seconds: 0.1, stdout: "", stderr: "" }] },
  },
  test: {
    input: { folder: "work/checkout" },
    output: {
      verdict: "passed",
      passed: 1,
      failed: 0,
      failedTests: [],
      seconds: 0.1,
      stdout: "ok one\nend\n",
      stderr: "",
    },
  },
  run: {
    input: { folder: "work/checkout", name: "demo", arguments: ["loud"] },
    output: { ended: "exited", exitCode: 0, seconds: 0.1, stdout: "demo\nloud\n", stdoutCut: false },
  },
};

type Replacement = { readonly file: string; readonly from: string; readonly to: string };

export function tallyFiles(name: string, variant: TallyVariant): ModeFiles {
  const replacements: Partial<Record<TallyVariant, Replacement>> = {
    "passes a check stopped at its limit": {
      file: "scripts/lib/tally.ts",
      from: stoppedLine,
      to: passedWhenStoppedLine,
    },
    "passes a check the checkout is not set up for": {
      file: "scripts/lib/tally.ts",
      from: notSetUpLine,
      to: passedWhenNotSetUpLine,
    },
    "says the project lacks nothing": { file: "scripts/describe.ts", from: missingLine, to: "      present.length;" },
    "names a file that did not load as a failing case": {
      file: "scripts/lib/tally.ts",
      from: failingLine,
      to: failingWithUnloadedLine,
    },
    "answers a command stopped at its limit as ended": {
      file: "scripts/run.ts",
      from: stoppedRunLine,
      to: endedWhenStoppedRunLine,
    },
  };
  const files = filesOfTally(name, variant);
  const replacement = replacements[variant];
  if (replacement === undefined) {
    return files;
  }
  const { file, from, to } = replacement;
  return { ...files, [file]: (files[file] ?? "").replace(from, to) };
}

function filesOfTally(name: string, variant: TallyVariant): ModeFiles {
  return {
    "mode.yaml": manifestOf(name, variant),
    "README.md": lines(
      `# ${name}`,
      "",
      "Checks and tests Tally, a made-up language. A test adds it to a copy of the kit.",
    ),
    "practices.md": lines("# Tally practices", "", "A made-up language has no practices yet."),
    "scripts/lib/tally.ts": library,
    "scripts/describe.ts": describeScript,
    "scripts/check.ts": checkScript,
    "scripts/run-tests.ts": testScript,
    "scripts/run.ts": runScript,
    "tests/describe.example.json": json(examples.describe),
    "tests/check.example.json": json(examples.check),
    "tests/test.example.json": json(examples.test),
    "tests/run.example.json": json(examples.run),
    "tests/checkout.ts": checkoutFunction,
    [`tests/${name}.test.ts`]: modeTest(name),
  };
}
