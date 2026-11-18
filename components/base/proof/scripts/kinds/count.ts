import type { CommandRan } from "../../../../../bay/sdk.ts";
import type { Count, Request } from "../lib/request.ts";
import { inCopy, type ProofStep } from "../lib/step.ts";
import { broken, counted, held, unknown, type Part, type Parts } from "../lib/verdicts.ts";

export type Lines =
  { readonly known: true; readonly lines: number } | { readonly known: false; readonly reason: string };

export type CountEvidence =
  | { readonly found: "not declared"; readonly name: string }
  | { readonly found: "most"; readonly most: number; readonly head: Lines }
  | { readonly found: "no rise"; readonly base: Lines; readonly head: Lines };

function holding(lines: number): string {
  return `${counted(lines, "line holds", "lines hold")} the counted text at the head`;
}

function notKnown(side: Lines): readonly Part[] {
  return side.known ? [] : [unknown(side.reason)];
}

function judged(said: string, part: Part): Parts {
  return { parts: [part], whenPassed: said };
}

function nothingKnown(first: Part, ...rest: readonly Part[]): Parts {
  return { parts: [first, ...rest], whenPassed: "" };
}

export function countParts(evidence: CountEvidence): Parts {
  switch (evidence.found) {
    case "not declared":
      return nothingKnown(
        unknown(`The project declares no count named ${evidence.name} in proof's settings, so nothing is known.`),
      );
    case "most": {
      const { head, most } = evidence;
      if (!head.known) {
        return nothingKnown(unknown(head.reason));
      }
      const said = `${holding(head.lines)}, and at most ${String(most)} may.`;
      return judged(said, head.lines <= most ? held : broken(said));
    }
    case "no rise": {
      const { base, head } = evidence;
      if (!head.known) {
        return nothingKnown(unknown(head.reason), ...notKnown(base));
      }
      if (!base.known) {
        return nothingKnown(unknown(base.reason));
      }
      const atBase = String(base.lines);
      return head.lines <= base.lines
        ? judged(`${holding(head.lines)}, and ${atBase} at the base.`, held)
        : judged("", broken(`${holding(head.lines)}, more than the ${atBase} at the base.`));
    }
  }
}

type Counted = { readonly pattern: string; readonly paths: readonly string[] };

type Side = { readonly commit: string; readonly on: "base" | "head" };

type InCopy = { readonly folder: string; readonly on: string };

const countMatches = "count-matches";

function linesIn(stdout: string): number {
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .reduce((total, line) => total + Number.parseInt(line, 10), 0);
}

function linesOf(ran: CommandRan, on: string, seconds: number): Lines {
  switch (ran.end.how) {
    case "timed-out":
      return { known: false, reason: `Counting at the ${on} did not finish within ${String(seconds)} seconds.` };
    case "signalled":
      return { known: false, reason: `Counting at the ${on} was stopped by the signal ${ran.end.signal}.` };
    case "exited": {
      const code = ran.end.exitCode;
      if (code !== 0 && code !== 1) {
        const said = `Counting at the ${on} ended with the exit code ${String(code)}`;
        return { known: false, reason: `${said}: a path to count in does not exist or could not be read.` };
      }
      return ran.stdout.cut
        ? { known: false, reason: `Counting at the ${on} printed more than proof reads.` }
        : { known: true, lines: linesIn(ran.stdout.text) };
    }
  }
}

async function linesInCopy(step: ProofStep, where: InCopy, counted: Counted): Promise<Lines> {
  const { folder, on } = where;
  const seconds = step.secondsLeft(1);
  if (seconds < 1) {
    return { known: false, reason: `Counting at the ${on} was not done: proof's own step had no time left for it.` };
  }
  const answer = await step.context.commands.run({
    name: countMatches,
    arguments: [counted.pattern, "--", ...counted.paths],
    folder,
    timeLimitSeconds: seconds,
  });
  if (!answer.ok) {
    step.spend(seconds);
    return { known: false, reason: `Counting at the ${on} could not be run: ${answer.message}` };
  }
  step.spend(answer.value.milliseconds / 1000);
  return linesOf(answer.value, on, seconds);
}

async function linesAt(step: ProofStep, side: Side, counted: Counted): Promise<Lines> {
  return inCopy(step, side.commit, (copy) =>
    copy.made
      ? linesInCopy(step, { folder: copy.folder, on: side.on }, counted)
      : Promise.resolve({ known: false, reason: copy.reason }),
  );
}

export async function countEvidence(step: ProofStep, request: Request, count: Count): Promise<CountEvidence> {
  if (count.of === "declared") {
    const declared = request.noRise.find((each) => each.name === count.name);
    return declared === undefined
      ? { found: "not declared", name: count.name }
      : countEvidence(step, request, { of: "no rise", pattern: declared.pattern, paths: declared.paths });
  }
  const head = await linesAt(step, { commit: request.head, on: "head" }, count);
  if (count.of === "most") {
    return { found: "most", most: count.most, head };
  }
  return { found: "no rise", base: await linesAt(step, { commit: request.base, on: "base" }, count), head };
}

export async function proveCount(step: ProofStep, request: Request, proof: { readonly count: Count }): Promise<Parts> {
  return countParts(await countEvidence(step, request, proof.count));
}
