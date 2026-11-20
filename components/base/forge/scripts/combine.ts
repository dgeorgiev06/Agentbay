import { defineScript, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { textOf } from "./lib/json-values.ts";
import { sideBySideOf } from "./lib/wave-batches.ts";
import { proving, slicesToJoin, type ToJoin, type WaveNamed } from "./lib/wave-join.ts";

type Combining = {
  readonly branch: string;
  readonly head: string;
  readonly merged: readonly string[];
};

type Combined = Combining & {
  readonly conflict?: { readonly slice: string; readonly reason: string };
};

async function startedAt(context: ScriptContext, wave: WaveNamed): Promise<Combining> {
  const cut = await answerOf(context, "worktrees.cut", { slice: wave.name, base: wave.base });
  await answerOf(context, "worktrees.remove", { folder: textOf(cut.folder), branchAfter: "kept" });
  return { branch: textOf(cut.branch), head: textOf(cut.commit), merged: [] };
}

async function joinedOnto(context: ScriptContext, at: Combining & { wave: string }, slice: ToJoin): Promise<Combined> {
  const cut = await answerOf(context, "worktrees.cut", { slice: `${at.wave}-${slice.name}`, base: slice.head });
  const folder = textOf(cut.folder);
  const merge = await context.call("worktrees.merge", { folder, into: at.branch });
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
  if (!merge.ok) {
    return { ...at, conflict: { slice: slice.name, reason: merge.message } };
  }
  return { ...at, head: textOf(fieldsOf(merge.value).commit), merged: [...at.merged, slice.name] };
}

async function combined(context: ScriptContext, wave: WaveNamed, slices: readonly ToJoin[]): Promise<Combined> {
  let at: Combined = await startedAt(context, wave);
  for (const slice of slices) {
    at = await joinedOnto(context, { ...at, wave: wave.name }, slice);
    if (at.conflict !== undefined) {
      return at;
    }
  }
  return at;
}

function joinedOf(at: Combined, slices: readonly ToJoin[]): Json {
  if (at.conflict !== undefined) {
    return { kind: "conflict", slice: at.conflict.slice, onto: [...at.merged], reason: at.conflict.reason };
  }
  return slices.length === 0
    ? { kind: "nothing to join" }
    : { kind: "combined", head: at.head, branch: at.branch, merged: [...at.merged] };
}

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const started = fieldsOf(fields.wave ?? null);
  const wave = { name: textOf(started.name), base: textOf(started.base) };
  const included = slicesToJoin(fields.slices ?? null).filter((slice) => slice.included);
  if (included.length === 0) {
    return { joined: joinedOf({ branch: "", head: wave.base, merged: [] }, []), proving: { kind: "not asked" } };
  }
  const at = await combined(context, wave, included);
  const sideBySide = sideBySideOf(context.settings.sideBySide);
  const asked =
    at.conflict === undefined ? proving(wave, included, { head: at.head, sideBySide }) : { kind: "not asked" };
  return { joined: joinedOf(at, included), proving: asked };
});
