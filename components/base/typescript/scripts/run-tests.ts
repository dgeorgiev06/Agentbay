import { defineScript } from "../../../../bay/sdk.ts";
import { runTimed } from "./lib/commands.ts";
import { checkoutRequestOf } from "./lib/request.ts";
import { testResult } from "./lib/results.ts";

const defaultSeconds = 420;

export const run = defineScript(async (input, context) => {
  const request = checkoutRequestOf(input, { namesField: "files", defaultSeconds });
  const finished = await runTimed(context, { ...request, name: "run-tests", arguments: request.names ?? [] });
  return testResult(finished, request.timeLimitSeconds);
});
