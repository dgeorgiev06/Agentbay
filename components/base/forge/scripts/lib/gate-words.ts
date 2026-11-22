import { joined } from "./card-lines.ts";
import type { Gate, Whole } from "./gate.ts";

export type Told = "before" | "after";

const settingName = "modeGateTests";

function writers(slices: readonly string[]): string {
  const [only, ...others] = slices;
  return only !== undefined && others.length === 0 ? `${only} writes` : "every slice writes";
}

function wholeReason(because: Whole): string {
  switch (because.why) {
    case "no slice":
      return "no slice is named";
    case "not a mode":
      return `${because.slice} is of kind ${because.kind}, not mode`;
    case "no scope":
      return `${because.slice} names no write scope`;
    case "outside":
      return `${because.slice} writes outside a mode's folder (${because.path})`;
    case "several modes":
      return `the slices write inside more than one mode's folder (${joined([...because.folders])})`;
  }
}

export function modeTestsFolder(gate: Extract<Gate, { readonly gate: "mode" }>): string {
  return `${gate.folder}/tests`;
}

export function gateLine(gate: Gate, slices: readonly string[], told: Told): string {
  if (gate.gate === "whole") {
    return `gate: the whole test run, since ${wholeReason(gate.because)}`;
  }
  const ran = told === "before" ? "" : " ran";
  const others = told === "before" ? "the other tests are not run" : "the other tests were not run";
  const since = `since ${writers(slices)} only inside ${gate.folder}`;
  return `gate: the mode's own tests and the fast checks of the whole project${ran}, ${since}; ${others}`;
}

export function fastChecksLine(gate: Gate, alsoRun: readonly string[]): readonly string[] {
  if (gate.gate === "whole") {
    return [];
  }
  const own = `every test file under ${modeTestsFolder(gate)} at the head`;
  const checks = "the toolchain's checks of the whole project";
  if (alsoRun.length === 0) {
    return [`the mode gate: ${own} and ${checks}; the setting ${settingName} names no other test`];
  }
  return [`the mode gate: ${own}, ${checks}, and ${joined([...alsoRun])}, the setting ${settingName}`];
}

export function modeChecksSays(gate: Extract<Gate, { readonly gate: "mode" }>): string {
  return (
    `The toolchain's checks of the whole project and the mode gate's tests, those under ${modeTestsFolder(gate)} ` +
    `and those the setting ${settingName} names, pass; the project's other tests are not run.`
  );
}

export function scopeClause(gate: Gate, scope: "passed" | "not passed"): readonly string[] {
  if (gate.gate === "whole" || scope === "passed") {
    return [];
  }
  return [`the mode gate stands only on scope passed, and scope did not pass`];
}

export function claimSentence(slice: string, items: readonly string[]): string {
  const named = items.length === 1 ? `item ${items[0] ?? ""} names` : `items ${joined([...items])} name`;
  return (
    `Slice ${slice}'s checks ${named} testsFrom, which forge alone sets, deciding the gate from the slices' kinds ` +
    "and scopes; leave testsFrom out."
  );
}
