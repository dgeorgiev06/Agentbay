import { defineScript } from "../../../../bay/sdk.ts";
import { testScript } from "./lib/checks.ts";
import { casesOf } from "./lib/cases.ts";
import { notStartedReason, realFolder, runTimed } from "./lib/commands.ts";
import { checkoutScripts, readinessOf } from "./lib/package-scripts.ts";
import { checkoutRequestOf } from "./lib/request.ts";
import { testResult, testRunSubject, type TestResult } from "./lib/results.ts";

function unrun(reason: string): TestResult {
  return { verdict: "inconclusive", reason, seconds: 0, stdout: "", stderr: "" };
}

export const run = defineScript(async (input, context) => {
  const request = checkoutRequestOf(input, "test");
  const readiness = readinessOf(testScript, await checkoutScripts(context, request));
  switch (readiness.kind) {
    case "not started":
      return unrun(notStartedReason(testRunSubject, readiness.reason));
    case "not set up":
      return unrun(readiness.reason);
    case "set up": {
      const finished = await runTimed(context, { ...request, name: "run-tests", arguments: request.names ?? [] });
      const result = testResult(finished, request.timeLimitSeconds);
      if (result.verdict !== "failed") {
        return result;
      }
      return { ...result, ...casesOf(finished.stdout, await realFolder(context, request.folder)) };
    }
  }
});
