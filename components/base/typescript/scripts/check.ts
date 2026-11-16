import { defineScript, fail } from "../../../../bay/sdk.ts";
import { checks, checkVerdict, type Check, type CheckVerdict } from "./lib/checks.ts";
import { npmRun, runTimed } from "./lib/commands.ts";
import { checkoutRequestOf } from "./lib/request.ts";

const defaultSeconds = 90;

function chosenChecks(names: readonly string[] | undefined): readonly Check[] {
  if (names === undefined) {
    return checks;
  }
  const known = checks.map((check) => check.name);
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    fail(`There is no check named ${unknown.join(" or ")}. The checks are: ${known.join(", ")}.`);
  }
  return checks.filter((check) => names.includes(check.name));
}

export const run = defineScript(async (input, context) => {
  const request = checkoutRequestOf(input, { namesField: "checks", defaultSeconds });
  const verdicts: CheckVerdict[] = [];
  for (const check of chosenChecks(request.names)) {
    const command = npmRun(check.name);
    const finished = await runTimed(context, { ...request, command });
    verdicts.push(checkVerdict(check, finished, request.timeLimitSeconds));
  }
  return { verdicts };
});
