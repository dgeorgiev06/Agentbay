import { canonicalJson, type Json } from "../../../../../bay/sdk.ts";
import { counted } from "./card-lines.ts";
import {
  actionName,
  actionsOf,
  designerAnswersOf,
  designOf,
  rulesOf,
  valuesDocument,
  type Action,
  type Design,
  type DesignerAnswer,
  type Example,
  type Value,
} from "./design-form.ts";

type Named = { readonly name: string };

type Sides = {
  readonly first: Design;
  readonly second: Design;
};

export type Labels = {
  readonly first: string;
  readonly second: string;
};

const apartLabels: Labels = { first: "the first", second: "the second" };

function onlyIn(first: readonly Named[], second: readonly Named[]): readonly string[] {
  const names = second.map((each) => each.name);
  return first.map((each) => each.name).filter((name) => !names.includes(name));
}

type Lists = {
  readonly first: readonly Named[];
  readonly second: readonly Named[];
};

function apart(kind: string, sides: Lists, labels: Labels): string[] {
  return [
    ...onlyIn(sides.first, sides.second).map((name) => `${kind} ${name}: only in ${labels.first} design`),
    ...onlyIn(sides.second, sides.first).map((name) => `${kind} ${name}: only in ${labels.second} design`),
  ];
}

const answerLabels: Labels = { first: "the first", second: "the answered" };

function paired<Each extends Named>(first: readonly Each[], second: readonly Each[]): readonly [Each, Each][] {
  return first.flatMap((each) => {
    const other = second.find((candidate) => candidate.name === each.name);
    const pair: readonly [Each, Each][] = other === undefined ? [] : [[each, other]];
    return pair;
  });
}

function modulesDiffer({ first, second }: Sides): readonly string[] {
  const shape = (module: Design["modules"][number]): string =>
    canonicalJson([module.implements, module.tables, module.files]);
  return paired(first.modules, second.modules).flatMap(([mine, theirs]) => [
    ...(shape(mine) === shape(theirs) ? [] : [`module ${mine.name}: implements or owns differ`]),
    ...(mine.hides === theirs.hides ? [] : [`module ${mine.name}: what it hides is worded differently`]),
  ]);
}

function exampleKey(example: Example): string {
  return canonicalJson({
    earlier: example.earlier.map((call) => ({ ...call })),
    input: example.input,
    ...example.told,
  });
}

function unmatched(keys: readonly string[], others: readonly string[]): number {
  const left = [...others];
  return keys.filter((key) => {
    const at = left.indexOf(key);
    if (at < 0) {
      return true;
    }
    left.splice(at, 1);
    return false;
  }).length;
}

function examplesDiffer(name: string, first: readonly Example[], second: readonly Example[]): readonly string[] {
  const mine = first.map(exampleKey);
  const theirs = second.map(exampleKey);
  const removed = unmatched(mine, theirs);
  const added = unmatched(theirs, mine);
  const changed = Math.min(removed, added);
  const counts = [
    { count: changed, how: "changed" },
    { count: added - changed, how: "added" },
    { count: removed - changed, how: "removed" },
  ];
  return counts
    .filter((each) => each.count > 0)
    .map((each) => `${name}: ${counted(each.count, "example")} ${each.how}`);
}

function sameValues(mine: readonly Value[], theirs: readonly Value[]): boolean {
  return canonicalJson(valuesDocument(mine)) === canonicalJson(valuesDocument(theirs));
}

function rulesDiffer({ first, second }: Sides): readonly string[] {
  return paired(rulesOf(first), rulesOf(second)).flatMap(([mine, theirs]) => [
    ...(mine.module === theirs.module ? [] : [`rule ${mine.name}: kept in another module`]),
    ...(sameValues(mine.takes, theirs.takes) ? [] : [`rule ${mine.name}: what it takes differs`]),
    ...(sameValues(mine.gives, theirs.gives) ? [] : [`rule ${mine.name}: what it gives differs`]),
    ...(mine.decides === theirs.decides ? [] : [`rule ${mine.name}: what it decides is worded differently`]),
  ]);
}

function appliedDiffers(mine: Placed, theirs: Placed): readonly string[] {
  const shape = (action: Placed): string => canonicalJson([action.rule ?? null, action.reads, action.writes]);
  return shape(mine) === shape(theirs)
    ? []
    : [`${mine.name}: the rule it applies, or what it reads or writes, differs`];
}

function actionsDiffer({ first, second }: Sides): readonly string[] {
  return paired(placed(first), placed(second)).flatMap(([mine, theirs]) => [
    ...appliedDiffers(mine, theirs),
    ...(mine.because === theirs.because ? [] : [`${mine.name}: why it serves no condition is worded differently`]),
    ...examplesDiffer(mine.name, mine.examples, theirs.examples),
  ]);
}

function saidDiffer(first: readonly DesignerAnswer[], second: readonly DesignerAnswer[]): readonly string[] {
  const named = (said: readonly DesignerAnswer[]): readonly (DesignerAnswer & Named)[] =>
    said.map((each) => ({ ...each, name: each.id }));
  const [mine, theirs] = [named(first), named(second)];
  return [
    ...onlyIn(mine, theirs).map((id) => `practice ${id}: the designer said how it holds only in the first`),
    ...onlyIn(theirs, mine).map((id) => `practice ${id}: the designer said how it holds only in the answered`),
    ...paired(mine, theirs).flatMap(([before, after]) =>
      before.sentence === after.sentence
        ? []
        : [`practice ${before.id}: the designer's sentence is worded differently`],
    ),
  ];
}

type Placed = Action & { readonly interface: string };

function placed(design: Design): readonly (Placed & Named)[] {
  return actionsOf(design).map((action) => ({ ...action, name: actionName(action) }));
}

function schemasDiffer({ first, second }: Sides): readonly string[] {
  return paired(placed(first), placed(second)).flatMap(([mine, theirs]) => {
    const sides = [
      { side: "request", differ: canonicalJson(mine.request) !== canonicalJson(theirs.request) },
      { side: "response", differ: canonicalJson(mine.response) !== canonicalJson(theirs.response) },
    ];
    return sides.filter((each) => each.differ).map((each) => `${mine.name}: the ${each.side} schemas differ`);
  });
}

function servers(design: Design, condition: string): string {
  const names = placed(design)
    .filter((action) => action.serves.includes(condition))
    .map((action) => action.name)
    .sort();
  return names.length === 0 ? "no action" : names.join(", ");
}

function coverageDiffers(sides: Sides, conditions: readonly string[], labels: Labels): readonly string[] {
  return conditions.flatMap((condition) => {
    const first = servers(sides.first, condition);
    const second = servers(sides.second, condition);
    return first === second
      ? []
      : [`${condition}: served by ${first} in ${labels.first}, by ${second} in ${labels.second}`];
  });
}

export function differences(
  sides: Sides,
  conditions: readonly string[],
  labels: Labels = apartLabels,
): readonly string[] {
  const { first, second } = sides;
  return [
    ...apart("module", { first: first.modules, second: second.modules }, labels),
    ...modulesDiffer(sides),
    ...apart("rule", { first: rulesOf(first), second: rulesOf(second) }, labels),
    ...rulesDiffer(sides),
    ...apart("interface", { first: first.interfaces, second: second.interfaces }, labels),
    ...apart("action", { first: placed(first), second: placed(second) }, labels),
    ...schemasDiffer(sides),
    ...actionsDiffer(sides),
    ...coverageDiffers(sides, conditions, labels),
  ];
}

export function answerChanges(first: Json, answered: Json, conditions: readonly string[]): readonly string[] {
  const sides = { first: designOf(first), second: designOf(answered) };
  return [
    ...differences(sides, conditions, answerLabels),
    ...saidDiffer(designerAnswersOf(first), designerAnswersOf(answered)),
  ];
}
