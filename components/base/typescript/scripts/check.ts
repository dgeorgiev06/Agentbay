import { defineScript, fail, type ScriptContext } from "../../../../bay/sdk.ts";
import { checks, checkVerdict, unrunVerdict, type Check, type CheckVerdict } from "./lib/checks.ts";
import { notStartedReason, runTimed } from "./lib/commands.ts";
import { checkoutScripts, hasScript, readinessOf, type CheckoutScripts } from "./lib/package-scripts.ts";
import { checkoutRequestOf, type CheckoutRequest } from "./lib/request.ts";

const defaultSeconds = 90;

function chosenChecks(names: readonly string[] | undefined, found: CheckoutScripts): readonly Check[] {
  if (names === undefined) {
    return checks.filter((check) => check.need.kind === "required" || hasScript(found, check));
  }
  const known = checks.map((check) => check.name);
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    fail(`There is no check named ${unknown.join(" or ")}. The checks are: ${known.join(", ")}.`);
  }
  return checks.filter((check) => names.includes(check.name));
}

async function verdictOf(
  context: ScriptContext,
  ran: { readonly check: Check; readonly found: CheckoutScripts; readonly request: CheckoutRequest },
): Promise<CheckVerdict> {
  const { check, found, request } = ran;
  const readiness = readinessOf(check, found);
  switch (readiness.kind) {
    case "not started":
      return unrunVerdict(check, notStartedReason(check.name, readiness.reason));
    case "not set up":
      return unrunVerdict(check, readiness.reason);
    case "set up": {
      const finished = await runTimed(context, { ...request, name: check.command, arguments: [] });
      return checkVerdict(check, finished, request.timeLimitSeconds);
    }
  }
}

export const run = defineScript(async (input, context) => {
  const request = checkoutRequestOf(input, { namesField: "checks", defaultSeconds });
  const found = await checkoutScripts(context, request);
  const verdicts: CheckVerdict[] = [];
  for (const check of chosenChecks(request.names, found)) {
    verdicts.push(await verdictOf(context, { check, found, request }));
  }
  return { verdicts };
});
