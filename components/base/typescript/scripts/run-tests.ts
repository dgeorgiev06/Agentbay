import { defineScript } from "../../../../bay/sdk.ts";
import { testScript } from "./lib/checks.ts";
import { notStartedReason, runTimed } from "./lib/commands.ts";
import { checkoutScripts, readinessOf } from "./lib/package-scripts.ts";
import { checkoutRequestOf } from "./lib/request.ts";
import { testResult, testRunSubject, type TestResult } from "./lib/results.ts";

const defaultSeconds = 420;

function unrun(reason: string): TestResult {
  return { verdict: "inconclusive", reason, seconds: 0, stdout: "", stderr: "" };
}

export const run = defineScript(async (input, context) => {
  const request = checkoutRequestOf(input, { namesField: "files", defaultSeconds });
  const readiness = readinessOf(testScript, await checkoutScripts(context, request));
  switch (readiness.kind) {
    case "not started":
      return unrun(notStartedReason(testRunSubject, readiness.reason));
    case "not set up":
      return unrun(readiness.reason);
    case "set up": {
      const finished = await runTimed(context, { ...request, name: "run-tests", arguments: request.names ?? [] });
      return testResult(finished, request.timeLimitSeconds);
    }
  }
});
