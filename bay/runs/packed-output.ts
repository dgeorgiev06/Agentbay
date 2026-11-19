import { gunzipSync, gzipSync } from "node:zlib";
import type { Action } from "../generated/mode.ts";

export type SkillOutputKeeping = NonNullable<Action["skillOutput"]>;

export const skillOutputKeepings: readonly SkillOutputKeeping[] = ["as-text", "kept-packed"];

export const keptPackedNote = "The kernel keeps this output packed and never shows it.";

export function keepingOf(action: Action): SkillOutputKeeping {
  return action.skillOutput ?? "as-text";
}

export function storedText(text: string, keeping: SkillOutputKeeping): string {
  switch (keeping) {
    case "as-text":
      return text;
    case "kept-packed":
      return gzipSync(Buffer.from(text, "utf8")).toString("base64");
  }
}

export function unpackedText(stored: string, keeping: SkillOutputKeeping): string {
  switch (keeping) {
    case "as-text":
      return stored;
    case "kept-packed":
      return gunzipSync(Buffer.from(stored, "base64")).toString("utf8");
  }
}
