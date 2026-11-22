import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { counted, joined, shortened } from "./card-lines.ts";
import { textOf, textsOf } from "./json-values.ts";
import type { Proved } from "./proof-answer.ts";
import type { Slice } from "./slice-form.ts";
import { isIncluded, type Settled } from "./wave-standing.ts";

export type Joined =
  | { readonly kind: "combined"; readonly head: string; readonly branch: string; readonly merged: readonly string[] }
  | { readonly kind: "conflict"; readonly slice: string; readonly onto: readonly string[]; readonly reason: string }
  | { readonly kind: "nothing to join" };

export type Checked = {
  readonly slice: Slice;
  readonly proof: Proved;
};

export type WaveChecks = { readonly kind: "not asked" } | ({ readonly kind: "asked" } & Checked);

export type Alone = Checked & {
  readonly name: string;
};

export type ChecksVerdict = "passed" | "failed" | "not known";

export type WaveAnswer = {
  readonly offered: boolean;
  readonly words: string;
  readonly reason?: string;
};

export function joinedOf(value: Json | undefined): Joined {
  const fields = fieldsOf(value ?? null);
  if (fields.kind === "combined") {
    return {
      kind: "combined",
      head: textOf(fields.head),
      branch: textOf(fields.branch),
      merged: textsOf(fields.merged),
    };
  }
  if (fields.kind === "conflict") {
    return { kind: "conflict", slice: textOf(fields.slice), onto: textsOf(fields.onto), reason: textOf(fields.reason) };
  }
  return { kind: "nothing to join" };
}

export function checksVerdict(checked: Checked): ChecksVerdict {
  const ids = checked.slice.done.map((item) => item.id);
  const verdicts = checked.proof.verdicts.filter((verdict) => ids.includes(verdict.item));
  if (verdicts.some((verdict) => verdict.verdict === "failed")) {
    return "failed";
  }
  const passed = verdicts.filter((verdict) => verdict.verdict === "passed").length;
  return passed === ids.length && ids.length > 0 ? "passed" : "not known";
}

const titleShown = 40;

function titled(slice: Settled): string {
  return `${slice.name} (${shortened(slice.title, titleShown)})`;
}

function titledName(slices: readonly Settled[], name: string): string {
  const slice = slices.find((each) => each.name === name);
  return slice === undefined ? name : titled(slice);
}

function joinReason(slices: readonly Settled[], joinedHead: Joined): string | undefined {
  switch (joinedHead.kind) {
    case "nothing to join":
      return "no slice passed its own proof";
    case "conflict": {
      const conflicting = titledName(slices, joinedHead.slice);
      return `${conflicting} does not merge cleanly onto ${joined(joinedHead.onto)} in the combined head`;
    }
    case "combined":
      return undefined;
  }
}

function checksReason(checks: WaveChecks): string | undefined {
  if (checks.kind === "not asked") {
    return "the wave's checks were not asked";
  }
  switch (checksVerdict(checks)) {
    case "passed":
      return undefined;
    case "failed":
      return "the wave's checks failed on the slices combined";
    case "not known":
      return "the wave's checks are not known";
  }
}

function leftOutClause(slices: readonly Settled[]): string {
  const left = slices.filter((slice) => !isIncluded(slice)).map(titled);
  if (left.length === 0) {
    return "";
  }
  const own = left.length === 1 ? "its own proof" : "their own proofs";
  return `; left out: ${joined(left)}, as ${own} did not pass`;
}

export type HeadProved = {
  readonly checks: WaveChecks;
  readonly examples?: readonly string[];
  readonly gate?: readonly string[];
};

function provedReason(proved: HeadProved): string | undefined {
  const clauses = [checksReason(proved.checks), ...(proved.examples ?? []), ...(proved.gate ?? [])].filter(
    (clause) => clause !== undefined,
  );
  return clauses.length === 0 ? undefined : clauses.join("; ");
}

export function waveAnswer(slices: readonly Settled[], joinedHead: Joined, proved: HeadProved): WaveAnswer {
  const because = joinReason(slices, joinedHead) ?? provedReason(proved);
  const left = leftOutClause(slices);
  if (because !== undefined) {
    const reason = `${because}${left}.`;
    return { offered: false, words: `Merge is not offered: ${reason}`, reason };
  }
  const included = slices.filter(isIncluded).length;
  const words =
    `Merge is offered for ${String(included)} of ${counted(slices.length, "slice")}: each passed its own ` +
    `proof, and the wave's checks passed on them combined${left}.`;
  return { offered: true, words };
}

export function aloneWords(alone: readonly Alone[]): readonly string[] {
  if (alone.length === 0) {
    return [];
  }
  const failed = alone.filter((each) => checksVerdict(each) === "failed").map((each) => each.name);
  const unknown = alone.filter((each) => checksVerdict(each) === "not known").map((each) => each.name);
  const failedWords =
    failed.length === 0
      ? []
      : [
          `${joined(failed)} ${failed.length === 1 ? "fails" : "fail"} the checks alone, so ` +
            `${failed.length === 1 ? "its" : "their"} work breaks the suite`,
        ];
  const unknownWords = unknown.length === 0 ? [] : [`not known alone: ${joined(unknown)}`];
  const eachPasses =
    failed.length === 0 && unknown.length === 0
      ? ["each slice passes the checks alone; only their combination fails them"]
      : [];
  return [...failedWords, ...unknownWords, ...eachPasses];
}
