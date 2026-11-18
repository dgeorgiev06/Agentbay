import { endedOf, type Finished } from "./commands.ts";

type Need =
  { readonly kind: "optional" } | { readonly kind: "required"; readonly example: string; readonly does: string };

export type AgreedScript = {
  readonly name: string;
  readonly need: Need;
};

export type Check = AgreedScript & {
  readonly command: string;
  readonly failedExitCodes: readonly number[];
};

function required(example: string, does: string): Need {
  return { kind: "required", example, does };
}

export const checks: readonly Check[] = [
  { name: "generate:check", need: { kind: "optional" }, command: "check-generated-types", failedExitCodes: [1] },
  {
    name: "typecheck",
    need: required("tsc --noEmit", "checks the types and exits 1 or 2 on a type error"),
    command: "check-types",
    failedExitCodes: [1, 2],
  },
  {
    name: "lint",
    need: required("eslint .", "lints the code and exits 1 on a finding"),
    command: "lint",
    failedExitCodes: [1],
  },
  {
    name: "format:check",
    need: required("prettier --check .", "checks the format and exits 1 on a finding"),
    command: "check-format",
    failedExitCodes: [1],
  },
  {
    name: "deadcode",
    need: required("knip", "finds unused files and exports and exits 1 on a finding"),
    command: "find-dead-code",
    failedExitCodes: [1],
  },
];

export const testScript: AgreedScript = {
  name: "test",
  need: required("node --test", "runs the tests with node's test runner"),
};

export const agreedScripts: readonly AgreedScript[] = [...checks, testScript];

type Shown = {
  readonly name: string;
  readonly seconds: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type CheckVerdict =
  | (Shown & { readonly verdict: "passed" })
  | (Shown & { readonly verdict: "failed" })
  | (Shown & { readonly verdict: "inconclusive"; readonly reason: string });

function exitVerdict(check: Check, exitCode: number): CheckVerdict["verdict"] {
  if (exitCode === 0) {
    return "passed";
  }
  return check.failedExitCodes.includes(exitCode) ? "failed" : "inconclusive";
}

export function unrunVerdict(check: Check, reason: string): CheckVerdict {
  return { name: check.name, verdict: "inconclusive", reason, seconds: 0, stdout: "", stderr: "" };
}

export function checkVerdict(check: Check, finished: Finished, timeLimitSeconds: number): CheckVerdict {
  const shown = { name: check.name, seconds: finished.seconds, stdout: finished.stdout, stderr: finished.stderr };
  const ended = endedOf(check.name, finished, timeLimitSeconds);
  if (ended.kind === "unfinished") {
    return { ...shown, verdict: "inconclusive", reason: ended.reason };
  }
  const verdict = exitVerdict(check, ended.exitCode);
  if (verdict === "inconclusive") {
    const code = String(ended.exitCode);
    const reason = `${check.name} ended with exit code ${code}, which the mode does not read as passed or failed.`;
    return { ...shown, verdict, reason };
  }
  return { ...shown, verdict };
}
