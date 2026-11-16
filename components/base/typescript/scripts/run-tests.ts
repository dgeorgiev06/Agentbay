import { defineScript } from "../../../../bay/sdk.ts";
import { runTimed } from "./lib/commands.ts";
import { checkoutRequestOf } from "./lib/request.ts";
import { testResult } from "./lib/results.ts";

const defaultSeconds = 420;

const npmTestWithTap = ["npm", "test", "--", "--test-reporter=tap"];

export const run = defineScript(async (input, context) => {
  const request = checkoutRequestOf(input, { namesField: "files", defaultSeconds });
  const command = [...npmTestWithTap, ...(request.names ?? [])];
  const finished = await runTimed(context, { ...request, command });
  return testResult(finished, request.timeLimitSeconds);
});
