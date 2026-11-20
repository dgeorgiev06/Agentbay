import { defineScript, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { branchesSaid, type Dropped, type Stayed } from "./lib/branch-endings.ts";
import { answerOf } from "./lib/called.ts";
import { cutAfresh, intoOf, removedThenDropped } from "./lib/drops.ts";
import { textOf } from "./lib/json-values.ts";
import { sideBySideOf } from "./lib/wave-batches.ts";
import { proving, slicesToJoin, type ToJoin, type WaveNamed } from "./lib/wave-join.ts";

type Combining = {
  readonly branch: string;
  readonly head: string;
  readonly merged: readonly string[];
  readonly dropped: readonly Dropped[];
  readonly stayed: readonly Stayed[];
};

type Combined = Combining & {
  readonly conflict?: { readonly slice: string; readonly reason: string };
};

async function startedAt(context: ScriptContext, wave: WaveNamed): Promise<Combining> {
  const cut = await cutAfresh(context, { slice: wave.name, base: wave.base }, intoOf(context));
  await answerOf(context, "worktrees.remove", { folder: cut.folder, branchAfter: "kept" });
  return { branch: cut.branch, head: cut.commit, merged: [], dropped: cut.over.dropped, stayed: cut.over.stayed };
}

async function joinedOnto(context: ScriptContext, at: Combining & { wave: string }, slice: ToJoin): Promise<Combined> {
  const into = intoOf(context);
  const cut = await cutAfresh(context, { slice: `${at.wave}-${slice.name}`, base: slice.head }, into);
  const merge = await context.call("worktrees.merge", { folder: cut.folder, into: at.branch });
  const drops = await removedThenDropped(context, cut, into);
  const stayed = [...at.stayed, ...drops.stayed];
  if (!merge.ok) {
    return { ...at, stayed, conflict: { slice: slice.name, reason: merge.message } };
  }
  return { ...at, stayed, head: textOf(fieldsOf(merge.value).commit), merged: [...at.merged, slice.name] };
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
    const nothing = { branch: "", head: wave.base, merged: [], dropped: [], stayed: [] };
    return { joined: joinedOf(nothing, []), proving: { kind: "not asked" } };
  }
  const at = await combined(context, wave, included);
  const sideBySide = sideBySideOf(context.settings.sideBySide);
  const asked =
    at.conflict === undefined ? proving(wave, included, { head: at.head, sideBySide }) : { kind: "not asked" };
  return { joined: joinedOf(at, included), proving: asked, ...branchesSaid(at.dropped, at.stayed) };
});
