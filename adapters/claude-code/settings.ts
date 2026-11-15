import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isRecord } from "./guard-input.ts";
import { listOf, parseObject, withMember, withoutMember, jsonText, type JsonObject } from "./json-file.ts";

export type SettingsAddition = {
  readonly kind: "settings";
  readonly entry: JsonObject;
  readonly createdHooks: boolean;
  readonly createdPreToolUse: boolean;
};

export type Merged<Addition> =
  | { readonly ok: true; readonly text: string; readonly addition: Addition }
  | { readonly ok: false; readonly message: string };

export type Unmerged = { readonly kind: "removed"; readonly value: JsonObject } | { readonly kind: "not-found" };

function shellQuoted(text: string): string {
  return `'${text}'`;
}

export function guardEntry(kit: string, root: string): JsonObject {
  const guard = join(kit, "adapters", "claude-code", "step-guard.ts");
  return {
    matcher: "*",
    hooks: [
      {
        type: "command",
        command: `node ${shellQuoted(guard)} --project ${shellQuoted(root)}`,
        timeout: 30,
        onFailure: "block",
      },
    ],
  };
}

export function mergeSettings(text: string | undefined, entry: JsonObject): Merged<SettingsAddition> {
  const parsed = parseObject(text);
  if (!parsed.ok) {
    return { ok: false, message: "is not a JSON object" };
  }
  const hooks = parsed.value["hooks"] ?? {};
  if (!isRecord(hooks)) {
    return { ok: false, message: "has a hooks entry that is not an object" };
  }
  const preToolUse = listOf(hooks["PreToolUse"] ?? []);
  if (preToolUse === undefined) {
    return { ok: false, message: "has a hooks.PreToolUse entry that is not a list" };
  }
  const merged = withMember(parsed.value, "hooks", withMember(hooks, "PreToolUse", [...preToolUse, entry]));
  const addition: SettingsAddition = {
    kind: "settings",
    entry,
    createdHooks: !("hooks" in parsed.value),
    createdPreToolUse: !("PreToolUse" in hooks),
  };
  return { ok: true, text: jsonText(merged), addition };
}

type HookList = { readonly settings: JsonObject; readonly hooks: JsonObject; readonly preToolUse: readonly unknown[] };

function hookListOf(text: string): HookList | undefined {
  const parsed = parseObject(text);
  if (!parsed.ok) {
    return undefined;
  }
  const hooks = parsed.value["hooks"];
  const preToolUse = isRecord(hooks) ? listOf(hooks["PreToolUse"]) : undefined;
  return isRecord(hooks) && preToolUse !== undefined ? { settings: parsed.value, hooks, preToolUse } : undefined;
}

export function unmergeSettings(text: string, addition: SettingsAddition): Unmerged {
  const found = hookListOf(text);
  const index = found?.preToolUse.findIndex((item) => isDeepStrictEqual(item, addition.entry)) ?? -1;
  if (found === undefined || index === -1) {
    return { kind: "not-found" };
  }
  const { settings, hooks, preToolUse } = found;
  const remaining = preToolUse.filter((_, position) => position !== index);
  const keepList = remaining.length > 0 || !addition.createdPreToolUse;
  const hooksLeft = keepList ? withMember(hooks, "PreToolUse", remaining) : withoutMember(hooks, "PreToolUse");
  const dropHooks = addition.createdHooks && Object.keys(hooksLeft).length === 0;
  return {
    kind: "removed",
    value: dropHooks ? withoutMember(settings, "hooks") : withMember(settings, "hooks", hooksLeft),
  };
}
