import type { Finished } from "./commands.ts";
import { isMissingScript } from "./commands.ts";

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

function inconclusiveReason(check: Check, finished: Finished, timeLimitSeconds: number): string | undefined {
  const { name } = check;
  const ending = finished.ending;
  switch (ending.how) {
    case "not-started":
      return `${name} could not be started: ${ending.reason}`;
    case "timed-out":
      return `${name} did not finish within ${String(timeLimitSeconds)} seconds and was stopped.`;
    case "signalled":
      return `${name} was stopped by the signal ${ending.signal}.`;
    case "exited":
      if (isMissingScript(finished, name)) {
        return `The checkout's package.json has no script ${name}, so the check could not be started.`;
      }
      if (ending.exitCode === 0 || check.failedExitCodes.includes(ending.exitCode)) {
        return undefined;
      }
      return `${name} ended with exit code ${String(ending.exitCode)}, which the mode does not read as passed or failed.`;
  }
}

export function checkVerdict(check: Check, finished: Finished, timeLimitSeconds: number): CheckVerdict {
  const shown = { name: check.name, seconds: finished.seconds, stdout: finished.stdout, stderr: finished.stderr };
  const reason = inconclusiveReason(check, finished, timeLimitSeconds);
  if (reason !== undefined) {
    return { ...shown, verdict: "inconclusive", reason };
  }
  const exitedWithZero = finished.ending.how === "exited" && finished.ending.exitCode === 0;
  return { ...shown, verdict: exitedWithZero ? "passed" : "failed" };
}
