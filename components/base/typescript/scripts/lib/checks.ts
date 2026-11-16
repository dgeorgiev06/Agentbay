import { endedOf, type Finished } from "./commands.ts";

export type Check = {
  readonly name: string;
  readonly failedExitCodes: readonly number[];
};

export const checks: readonly Check[] = [
  { name: "generate:check", failedExitCodes: [1] },
  { name: "typecheck", failedExitCodes: [1, 2] },
  { name: "lint", failedExitCodes: [1] },
  { name: "format:check", failedExitCodes: [1] },
  { name: "deadcode", failedExitCodes: [1] },
];

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

export function checkVerdict(check: Check, finished: Finished, timeLimitSeconds: number): CheckVerdict {
  const shown = { name: check.name, seconds: finished.seconds, stdout: finished.stdout, stderr: finished.stderr };
  const ended = endedOf({ subject: check.name, script: check.name }, finished, timeLimitSeconds);
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
