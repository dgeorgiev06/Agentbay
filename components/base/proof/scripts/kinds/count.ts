import {
  broken,
  counted,
  held,
  unknown,
  type Part,
  type Parts,
} from "../lib/verdicts.ts";

export type Lines =
  | { readonly known: true; readonly lines: number }
  | { readonly known: false; readonly reason: string };

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
        unknown(
          `The project declares no count named ${evidence.name} in proof's settings, so nothing is known.`,
        ),
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
        : judged(
            "",
            broken(
              `${holding(head.lines)}, more than the ${atBase} at the base.`,
            ),
          );
    }
  }
}
