import { gunzipSync, gzipSync } from "node:zlib";
import type { Action, Keeping } from "../generated/mode.ts";

export const keepings: readonly Keeping[] = ["as-text", "kept-packed"];

export const keptPackedNote = "The kernel keeps this output packed and never shows it.";

export const keptInputNote = "The kernel keeps this input packed and never shows it.";

export const keptReasonNote = "The kernel keeps this reason packed and never shows it.";

export function keepingOf(action: Action): Keeping {
  return action.skillOutput ?? "as-text";
}

export function callsKeepingOf(action: Action, within: Keeping): Keeping {
  return within === "kept-packed" ? within : (action.calledOutputs ?? "as-text");
}

export function eitherKeeping(first: Keeping, second: Keeping): Keeping {
  return first === "kept-packed" ? first : second;
}

export function withheldReason(what: string): string {
  return `${what} failed; the kernel keeps its reason packed.`;
}

export function storedText(text: string, keeping: Keeping): string {
  switch (keeping) {
    case "as-text":
      return text;
    case "kept-packed":
      return gzipSync(Buffer.from(text, "utf8")).toString("base64");
  }
}

export function unpackedText(stored: string, keeping: Keeping): string {
  switch (keeping) {
    case "as-text":
      return stored;
    case "kept-packed":
      return gunzipSync(Buffer.from(stored, "base64")).toString("utf8");
  }
}
