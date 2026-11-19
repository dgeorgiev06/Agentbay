import { defineScript, type Json } from "../../../../bay/sdk.ts";
import { runTimed, type Finished } from "./lib/commands.ts";
import { checkoutScripts, namedScriptReason, type CheckoutScripts } from "./lib/package-scripts.ts";
import { runRequestOf, type RunRequest } from "./lib/request.ts";

function notRun(ended: "not set up" | "not started", reason: string): Json {
  return { ended, reason, seconds: 0 };
}

function answerOf(request: RunRequest, finished: Finished): Json {
  const { ending, seconds, stdout, stdoutCut } = finished;
  const subject = `The script ${request.name}`;
  const shown = { seconds, stdout, stdoutCut };
  switch (ending.how) {
    case "not-started":
      return notRun("not started", `${subject} could not be started: ${ending.reason}`);
    case "timed-out": {
      const limit = String(request.timeLimitSeconds);
      return {
        ended: "timed-out",
        reason: `${subject} did not finish within ${limit} seconds and was stopped.`,
        ...shown,
      };
    }
    case "signalled": {
      const { signal } = ending;
      return { ended: "signalled", signal, reason: `${subject} was stopped by the signal ${signal}.`, ...shown };
    }
    case "exited":
      return { ended: "exited", exitCode: ending.exitCode, ...shown };
  }
}

function notRunnable(request: RunRequest, found: CheckoutScripts): Json | undefined {
  if (found.kind === "not started") {
    return notRun("not started", `The script ${request.name} could not be started: ${found.reason}`);
  }
  if (found.kind !== "listed" || !found.names.has(request.name)) {
    return notRun("not set up", namedScriptReason(found, request.name));
  }
  return undefined;
}

export const run = defineScript(async (input, context) => {
  const request = runRequestOf(input);
  const refused = notRunnable(request, await checkoutScripts(context, request));
  if (refused !== undefined) {
    return refused;
  }
  const words = [request.name, ...request.arguments];
  return answerOf(request, await runTimed(context, { ...request, name: "run-script", arguments: words }));
});
