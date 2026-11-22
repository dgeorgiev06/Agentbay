import { joined } from "./card-lines.ts";
import type { Gate, Whole } from "./gate.ts";

type ModeGate = Extract<Gate, { readonly gate: "mode" }>;

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

export type GateRan = "chosen" | "no own test" | "every test" | "not said";

export type Told = "before" | GateRan;

function sinceMode(gate: ModeGate, slices: readonly string[]): string {
  return `since ${writers(slices)} only inside ${gate.folder}`;
}

function modeGateLine(gate: ModeGate, slices: readonly string[], told: Told): string {
  const since = sinceMode(gate, slices);
  const gated = "gate: the mode's own tests and the fast checks of the whole project";
  switch (told) {
    case "before":
      return `${gated}, ${since}; the other tests are not run`;
    case "chosen":
      return `${gated} ran, ${since}; the other tests were not run`;
    case "no own test":
      return `gate: the mode gate, ${since}; the mode has no test file of its own, so the checks item is not known`;
    case "every test":
      return `gate: the mode gate was asked for, ${since}, but proof's answer says it ran every test`;
    case "not said":
      return `gate: the mode gate was asked for, ${since}; proof's answer does not say which tests ran`;
  }
}

export function gateLine(gate: Gate, slices: readonly string[], told: Told): string {
  if (gate.gate === "whole") {
    return `gate: the whole test run, since ${wholeReason(gate.because)}`;
  }
  return modeGateLine(gate, slices, told);
}

export function fastChecksLine(gate: Gate, alsoRun: readonly string[]): readonly string[] {
  if (gate.gate === "whole") {
    return [];
  }
  const own = `every test file under ${gate.folder} at the head`;
  const checks = "the toolchain's checks of the whole project, bay check on the head";
  if (alsoRun.length === 0) {
    return [`the mode gate: ${own}, ${checks}; the setting ${settingName} adds no test`];
  }
  return [`the mode gate: ${own}, ${checks}, and ${joined([...alsoRun])}, which the setting ${settingName} adds`];
}

export function modeChecksSays(gate: ModeGate): string {
  return (
    `The toolchain's checks of the whole project, bay check on the head and the mode gate's tests, those under ` +
    `${gate.folder} and those the setting ${settingName} adds, pass; the project's other tests are not run.`
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
    `Slice ${slice}'s checks ${named} testsFrom or bayCheck, which forge alone sets, deciding the gate from the ` +
    "slices' kinds and scopes; leave them out."
  );
}

export function gateDiffers(handed: Gate, worked: Gate): string {
  const said = (gate: Gate): string => (gate.gate === "mode" ? `mode, ${gate.folder}` : "whole");
  return (
    `forge was handed the gate ${said(handed)}, but the slices give ${said(worked)}; the checks ran by the slices' ` +
    "gate, and this item fails for the difference."
  );
}
