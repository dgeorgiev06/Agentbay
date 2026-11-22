import { fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import { textOf, textsOf } from "./json-values.ts";

export type Gated = {
  readonly name: string;
  readonly kind: string;
  readonly scope: readonly string[];
};

export type Whole =
  | { readonly why: "no slice" }
  | { readonly why: "not a mode"; readonly slice: string; readonly kind: string }
  | { readonly why: "no scope"; readonly slice: string }
  | { readonly why: "outside"; readonly slice: string; readonly path: string }
  | { readonly why: "several modes"; readonly folders: readonly string[] };

export type Gate =
  | { readonly gate: "mode"; readonly mode: string; readonly folder: string }
  | { readonly gate: "whole"; readonly because: Whole };

const modesFolder = ["components", "modes"] as const;

const modeName = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function modeFolder(mode: string): string {
  return [...modesFolder, mode].join("/");
}

export function modeOfPath(path: string): string | undefined {
  const [top, tier, mode, ...below] = path.split("/");
  const inModes = top === modesFolder[0] && tier === modesFolder[1];
  const plain = below.every((part) => part !== "" && part !== "." && part !== "..");
  if (!inModes || mode === undefined || !modeName.test(mode) || below.length === 0 || !plain) {
    return undefined;
  }
  return mode;
}

function wholeBySlice(slice: Gated): Whole | undefined {
  if (slice.kind !== "mode") {
    return { why: "not a mode", slice: slice.name, kind: slice.kind };
  }
  if (slice.scope.length === 0) {
    return { why: "no scope", slice: slice.name };
  }
  const outside = slice.scope.find((path) => modeOfPath(path) === undefined);
  return outside === undefined ? undefined : { why: "outside", slice: slice.name, path: outside };
}

export function gateOf(slices: readonly Gated[]): Gate {
  if (slices.length === 0) {
    return { gate: "whole", because: { why: "no slice" } };
  }
  const whole = slices.map(wholeBySlice).find((because) => because !== undefined);
  if (whole !== undefined) {
    return { gate: "whole", because: whole };
  }
  const modes = [...new Set(slices.flatMap((slice) => slice.scope.flatMap((path) => modeOfPath(path) ?? [])))];
  const [mode, ...others] = modes.sort();
  if (mode === undefined || others.length > 0) {
    return { gate: "whole", because: { why: "several modes", folders: modes.map(modeFolder) } };
  }
  return { gate: "mode", mode, folder: modeFolder(mode) };
}

function wholeOf(fields: JsonFields): Whole {
  switch (textOf(fields.why)) {
    case "not a mode":
      return { why: "not a mode", slice: textOf(fields.slice), kind: textOf(fields.kind) };
    case "no scope":
      return { why: "no scope", slice: textOf(fields.slice) };
    case "outside":
      return { why: "outside", slice: textOf(fields.slice), path: textOf(fields.path) };
    case "several modes":
      return { why: "several modes", folders: textsOf(fields.folders) };
    default:
      return { why: "no slice" };
  }
}

export function gateFrom(value: Json | undefined): Gate {
  const fields = fieldsOf(value ?? null);
  const mode = textOf(fields.mode);
  if (fields.gate === "mode" && modeName.test(mode) && fields.folder === modeFolder(mode)) {
    return { gate: "mode", mode, folder: modeFolder(mode) };
  }
  return { gate: "whole", because: wholeOf(fieldsOf(fields.because ?? null)) };
}
