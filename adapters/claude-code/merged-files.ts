import type { BuildRequest } from "../../bay/adapter.ts";
import { sha256, type Addition, type MergedFile } from "./build-record.ts";
import { bayCommand, coordinatorBlock, insertBlock, removeBlock, replaceBlock } from "./coordinator.ts";
import { isEmptyObject, jsonText } from "./json-file.ts";
import { kernelServer, mergeMcp, unmergeMcp } from "./mcp-config.ts";
import { guardEntry, mergeSettings, unmergeSettings, type Merged } from "./settings.ts";

export type MergeTarget = {
  readonly path: string;
  readonly merge: (base: string | undefined, current: string | undefined, previous?: Addition) => Merged<Addition>;
};

type Remainder =
  { readonly kind: "removed"; readonly text: string; readonly empty: boolean } | { readonly kind: "not-found" };

export type Restored =
  | { readonly kind: "restored"; readonly text: string | undefined; readonly exact: boolean }
  | { readonly kind: "changed" };

export type MergePlan = {
  readonly path: string;
  readonly text: string;
  readonly entry: MergedFile;
  readonly change: "merged" | "updated" | "unchanged";
};

function blockTarget(request: BuildRequest): MergeTarget {
  const block = coordinatorBlock(bayCommand(request.layout));
  return {
    path: "CLAUDE.md",
    merge: (base, current, previous) => {
      const inPlace = current === undefined ? undefined : replaceBlock(current, block);
      if (inPlace !== undefined) {
        const separator = previous?.kind === "claude-md" ? previous.separator : "";
        return { ok: true, text: inPlace, addition: { kind: "claude-md", separator } };
      }
      return { ok: true, ...insertBlock(base, block) };
    },
  };
}

export function mergeTargets(request: BuildRequest): readonly MergeTarget[] {
  const entry = guardEntry(request.layout);
  const server = kernelServer(request.layout);
  return [
    { path: ".claude/settings.json", merge: (base) => mergeSettings(base, entry) },
    { path: ".mcp.json", merge: (base) => mergeMcp(base, server) },
    blockTarget(request),
  ];
}

function unmerged(text: string, addition: Addition): Remainder {
  switch (addition.kind) {
    case "settings":
    case "mcp": {
      const result = addition.kind === "settings" ? unmergeSettings(text, addition) : unmergeMcp(text, addition);
      return result.kind === "removed"
        ? { kind: "removed", text: jsonText(result.value), empty: isEmptyObject(result.value) }
        : result;
    }
    case "claude-md": {
      const remaining = removeBlock(text, addition);
      return remaining === undefined
        ? { kind: "not-found" }
        : { kind: "removed", text: remaining, empty: remaining === "" };
    }
  }
}

export function restoredText(current: string, entry: MergedFile): Restored {
  if (sha256(current) === entry.writtenSha256) {
    return { kind: "restored", text: entry.existedBefore ? (entry.originalText ?? "") : undefined, exact: true };
  }
  const remainder = unmerged(current, entry.addition);
  if (remainder.kind === "not-found") {
    return { kind: "changed" };
  }
  const deleted = !entry.existedBefore && remainder.empty;
  return { kind: "restored", text: deleted ? undefined : remainder.text, exact: false };
}

type Base = { readonly text: string | undefined; readonly existedBefore: boolean };

function baseOf(target: MergeTarget, current: string | undefined, previous: MergedFile | undefined): Base | string {
  if (previous === undefined || current === undefined) {
    return { text: current, existedBefore: current !== undefined };
  }
  const restored = restoredText(current, previous);
  if (restored.kind === "restored") {
    return { text: restored.text, existedBefore: previous.existedBefore };
  }
  if (target.path === "CLAUDE.md") {
    return { text: current, existedBefore: true };
  }
  return "the part agentbay added was changed by hand since the last build; remove it or restore it, then build again";
}

export function planMerge(target: MergeTarget, current: string | undefined, previous?: MergedFile): MergePlan | string {
  const base = baseOf(target, current, previous);
  if (typeof base === "string") {
    return base;
  }
  const merged = target.merge(base.text, current, previous?.addition);
  if (!merged.ok) {
    return merged.message;
  }
  const entry: MergedFile = {
    path: target.path,
    existedBefore: base.existedBefore,
    originalText: base.text ?? null,
    writtenSha256: sha256(merged.text),
    addition: merged.addition,
  };
  const change = current === undefined || previous === undefined ? "merged" : "updated";
  return { path: target.path, text: merged.text, entry, change: merged.text === current ? "unchanged" : change };
}
