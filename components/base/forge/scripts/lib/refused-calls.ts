import { canonicalJson } from "../../../../../bay/sdk.ts";
import type { Call, Design, Example, Interface } from "./design-form.ts";

type Placed = {
  readonly action: string;
  readonly index: number;
  readonly example: Example;
};

function placedIn(each: Interface): readonly Placed[] {
  return each.actions.flatMap((action) =>
    action.examples.map((example, index) => ({ action: action.name, index, example })),
  );
}

function callsKey(calls: readonly Call[]): string {
  return canonicalJson(calls.map((call) => ({ ...call })));
}

function refusedAfter(examples: readonly Placed[], before: readonly Call[], call: Call): boolean {
  return examples.some(
    ({ action, example }) =>
      action === call.action &&
      "refusal" in example.told &&
      callsKey(example.earlier) === callsKey(before) &&
      canonicalJson(example.input) === canonicalJson(call.input),
  );
}

function withoutRefused(examples: readonly Placed[], earlier: readonly Call[]): readonly Call[] {
  return earlier.reduce<readonly Call[]>(
    (kept, call) => (refusedAfter(examples, kept, call) ? kept : [...kept, call]),
    [],
  );
}

function sameWithout(examples: readonly Placed[], placed: Placed): Placed | undefined {
  const kept = withoutRefused(examples, placed.example.earlier);
  if (kept.length === placed.example.earlier.length) {
    return undefined;
  }
  return examples.find(
    ({ action, example }) =>
      action === placed.action &&
      callsKey(example.earlier) === callsKey(kept) &&
      canonicalJson(example.input) === canonicalJson(placed.example.input),
  );
}

function toldKey(example: Example): string {
  return canonicalJson({ ...example.told });
}

function interfaceProblems(each: Interface): readonly string[] {
  const examples = placedIn(each);
  return examples.flatMap((placed) => {
    const other = sameWithout(examples, placed);
    if (other === undefined || toldKey(other.example) === toldKey(placed.example)) {
      return [];
    }
    const name = `"${each.name}.${placed.action}"`;
    return [
      `Example ${String(placed.index + 1)} of ${name} comes after calls the design's examples refuse, yet it ` +
        `answers otherwise than example ${String(other.index + 1)}, which makes the same calls without them; a ` +
        "refused call writes nothing, so the two must answer the same.",
    ];
  });
}

export function refusedCallsThatWrite(design: Design): readonly string[] {
  return design.interfaces.flatMap(interfaceProblems);
}
