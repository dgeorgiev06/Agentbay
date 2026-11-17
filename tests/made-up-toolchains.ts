import { stringify } from "yaml";

export type ModeFiles = Readonly<Record<string, string>>;

export type TallyVariant = "stops a check at its limit" | "passes a check stopped at its limit";

export const tally = "tally";

export const wrongTally = "tally-wrong";

const sdkFromScripts = "../../../../bay/sdk.ts";

const sdkFromLibrary = "../../../../../bay/sdk.ts";

const checkNames = ["spelling", "line-length"];

const effectsOfARun = ["read", "write", "network", "spend", "delete"];

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function lines(...texts: readonly string[]): string {
  return `${texts.join("\n")}\n`;
}

function manifestOf(name: string): string {
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
      commands: [...checkNames.map((check) => `sh checks/${check}.sh`), "sh run-tests.sh"],
    },
    extraFiles: ["practices.md"],
    actions: {
      describe: action("When a test needs Tally's files, practices and checks.", "scripts/describe.ts", []),
      check: action("When a test needs Tally's checks run in a checkout.", "scripts/check.ts", effectsOfARun),
      test: action("When a test needs Tally's tests run in a checkout.", "scripts/run-tests.ts", effectsOfARun),
    },
  });
}

const stoppedLine = '      return { ...shown, ending: { kind: "unknown", reason: stoppedReason(limit) } };';

const passedWhenStoppedLine = '      return { ...shown, ending: { kind: "exited", exitCode: 0 } };';

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

export function requestOf(input: Json, namesField: string): Request {
  const fields = fieldsOf(input);
  const names = fields[namesField];
  const seconds = fields.timeLimitSeconds;
  return {
    folder: typeof fields.folder === "string" ? fields.folder : "",
    names: Array.isArray(names) ? names.filter((name) => typeof name === "string") : undefined,
    timeLimitSeconds: typeof seconds === "number" ? seconds : 60,
  };
}

function stoppedReason(limit: number): string {
  return "It did not finish within " + String(limit) + " seconds and was stopped.";
}

export async function ran(context: ScriptContext, command: readonly string[], request: Request): Promise<Ran> {
  const limit = request.timeLimitSeconds;
  const answer = await context.commands.run({ command, folder: request.folder, timeLimitSeconds: limit });
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

export function testResult(result: Ran): Json {
  const shown = { seconds: result.seconds, stdout: result.stdout, stderr: result.stderr };
  const unknown = (reason: string): Json => ({ ...shown, verdict: "inconclusive", reason });
  if (result.ending.kind === "unknown") {
    return unknown(result.ending.reason);
  }
  const reported = result.stdout.split("\n");
  const passed = reported.filter((line) => line.startsWith("ok ")).length;
  const failedTests = reported.filter((line) => line.startsWith("not ok ")).map((line) => line.slice(7));
  const counts = { passed, failed: failedTests.length, failedTests };
  if (!reported.includes("end")) {
    return unknown("The run did not report its end.");
  }
  if (passed + failedTests.length === 0) {
    return unknown("The run had no tests.");
  }
  const code = result.ending.exitCode;
  if (code === 0 && failedTests.length === 0) {
    return { ...shown, ...counts, verdict: "passed" };
  }
  if (code === 1 && failedTests.length > 0) {
    return { ...shown, ...counts, verdict: "failed" };
  }
  return unknown("The run ended with exit code " + String(code) + ".");
}
`;

function describeScript(name: string): string {
  return lines(
    `import { defineScript } from "${sdkFromScripts}";`,
    'import { checks } from "./lib/tally.ts";',
    "",
    "export const run = defineScript(() =>",
    "  Promise.resolve({",
    '    language: "Tally",',
    '    sourceFiles: ["**/*.tally"],',
    '    testFiles: ["tests/**/*.test.tally"],',
    `    practices: "components/base/${name}/practices.md",`,
    "    checks: [...checks],",
    "  }),",
    ");",
  );
}

const checkScript = lines(
  `import { defineScript, fail } from "${sdkFromScripts}";`,
  'import { checks, checkVerdict, ran, requestOf } from "./lib/tally.ts";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const request = requestOf(input, "checks");',
  "  const asked = request.names ?? checks;",
  "  const unknown = asked.filter((name) => !checks.includes(name));",
  "  if (unknown.length > 0) {",
  '    fail("Tally has no check named " + unknown.join(" or ") + ".");',
  "  }",
  "  const verdicts = [];",
  "  for (const name of checks.filter((check) => asked.includes(check))) {",
  '    verdicts.push(checkVerdict(name, await ran(context, ["sh", "checks/" + name + ".sh"], request)));',
  "  }",
  "  return { verdicts };",
  "});",
);

const testScript = lines(
  `import { defineScript } from "${sdkFromScripts}";`,
  'import { ran, requestOf, testResult } from "./lib/tally.ts";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const request = requestOf(input, "files");',
  '  return testResult(await ran(context, ["sh", "run-tests.sh", ...(request.names ?? [])], request));',
  "});",
);

const checkoutFunction = String.raw`import type { Files, Outcome, Wanted, WantedCheck, WantedTest } from "../../interfaces/toolchain/tests/shared.ts";

const checkBodies: Readonly<Record<Outcome, string>> = {
  passes: "",
  fails: "exit 1",
  "does not end": "sleep 600",
};

const testWords: Readonly<Record<Outcome, string>> = {
  passes: "pass",
  fails: "fail",
  "does not end": "hang",
};

const runner = [
  'if [ "$#" -eq 0 ]; then set -- $(find tests -name "*.test.tally" 2>/dev/null | sort); fi',
  "status=0",
  'for file in "$@"; do',
  "  while IFS= read -r line; do",
  '    case "$line" in',
  '      "pass "*) echo "ok ${"$"}{line#pass }" ;;',
  '      "fail "*) echo "not ok ${"$"}{line#fail }"; status=1 ;;',
  '      "hang "*) sleep 600 ;;',
  "    esac",
  '  done < "$file"',
  "done",
  'echo "end"',
  "exit $status",
  "",
].join("\n");

function checkScriptOf(check: WantedCheck): string {
  return ["echo " + JSON.stringify(check.line), checkBodies[check.outcome], ""].join("\n");
}

function testLineOf(test: WantedTest): string {
  return testWords[test.outcome] + " " + test.name;
}

export function tallyCheckout(wanted: Wanted): Files {
  const checks = wanted.checks.map((check) => ["checks/" + check.name + ".sh", checkScriptOf(check)]);
  const tests = wanted.testFiles.map((file, index) => [
    "tests/file-" + String(index + 1) + ".test.tally",
    [...file.map(testLineOf), ""].join("\n"),
  ]);
  return {
    "run-tests.sh": runner,
    "src/main.tally": "pass the source\n",
    ...Object.fromEntries(checks),
    ...Object.fromEntries(tests),
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
      practices: "components/base/tally/practices.md",
      checks: checkNames,
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
};

export function tallyFiles(name: string, variant: TallyVariant): ModeFiles {
  const chosen =
    variant === "stops a check at its limit" ? library : library.replace(stoppedLine, passedWhenStoppedLine);
  return {
    "mode.yaml": manifestOf(name),
    "README.md": lines(
      `# ${name}`,
      "",
      "Checks and tests Tally, a made-up language. A test adds it to a copy of the kit.",
    ),
    "practices.md": lines("# Tally practices", "", "A made-up language has no practices yet."),
    "scripts/lib/tally.ts": chosen,
    "scripts/describe.ts": describeScript(name),
    "scripts/check.ts": checkScript,
    "scripts/run-tests.ts": testScript,
    "tests/describe.example.json": json(examples.describe),
    "tests/check.example.json": json(examples.check),
    "tests/test.example.json": json(examples.test),
    "tests/checkout.ts": checkoutFunction,
    [`tests/${name}.test.ts`]: modeTest(name),
  };
}
