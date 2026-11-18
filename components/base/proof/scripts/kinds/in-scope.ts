import { pathMatch } from "../../../../../bay/sdk.ts";
import type { Request } from "../lib/request.ts";
import type { ProofStep } from "../lib/step.ts";
import { broken, counted, held, unknown, type Parts } from "../lib/verdicts.ts";
import { changedBetween, changedNotKnown, touchedPaths, type Changed } from "./touched.ts";

const namedCharacters = 1500;

const anyPath = "any";

function inScope(scope: readonly string[], path: string): boolean {
  return scope.some((pattern) => pathMatch(pattern, path).kind === "matched");
}

function patternFaults(scope: readonly string[]): readonly string[] {
  return scope.flatMap((pattern) => {
    const answer = pathMatch(pattern, anyPath);
    return answer.kind === "not a pattern" ? [answer.reason] : [];
  });
}

function namesThatFit(paths: readonly string[]): readonly string[] {
  const shown: string[] = [];
  let length = 0;
  for (const path of paths) {
    length += (shown.length === 0 ? 0 : ", ".length) + path.length;
    if (length > namedCharacters) {
      break;
    }
    shown.push(path);
  }
  return shown;
}

function outsideSaid(outside: readonly string[]): string {
  const count = counted(outside.length, "changed path is", "changed paths are");
  const shown = namesThatFit(outside);
  if (shown.length === 0) {
    const tooLong = outside.length === 1 ? "its name is" : "the first name is";
    return `${count} outside the scope, and ${tooLong} too long to show here.`;
  }
  const more = outside.length - shown.length;
  return `${count} outside the scope: ${shown.join(", ")}${more > 0 ? `, and ${String(more)} more` : ""}.`;
}

export function inScopeParts(scope: readonly string[], changed: Changed): Parts {
  if (!changed.known) {
    return { parts: [unknown(changedNotKnown)], whenPassed: "" };
  }
  const [fault] = patternFaults(scope);
  if (fault !== undefined) {
    return {
      parts: [unknown(`The write scope holds an entry that is not a pattern, so nothing is known: ${fault}`)],
      whenPassed: "",
    };
  }
  const touched = touchedPaths(changed.paths);
  const outside = touched.filter((path) => !inScope(scope, path));
  const count = String(touched.length);
  return {
    parts: [outside.length === 0 ? held : broken(outsideSaid(outside))],
    whenPassed: `Every changed path is in the scope: ${count} of ${count}.`,
  };
}

export async function proveInScope(step: ProofStep, request: Request): Promise<Parts> {
  return inScopeParts(request.scope, await changedBetween(step, request));
}
