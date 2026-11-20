import { canonicalJson } from "../../../../../bay/sdk.ts";
import { actionName, actionsOf, type Action, type Design } from "./design-form.ts";

type Named = { readonly name: string };

type Sides = {
  readonly first: Design;
  readonly second: Design;
};

function onlyIn(first: readonly Named[], second: readonly Named[]): readonly string[] {
  const names = second.map((each) => each.name);
  return first.map((each) => each.name).filter((name) => !names.includes(name));
}

function apart(kind: string, sides: { readonly first: readonly Named[]; readonly second: readonly Named[] }): string[] {
  return [
    ...onlyIn(sides.first, sides.second).map((name) => `${kind} ${name}: only in the first design`),
    ...onlyIn(sides.second, sides.first).map((name) => `${kind} ${name}: only in the second design`),
  ];
}

function moduleShape(design: Design, name: string): string {
  const module = design.modules.find((each) => each.name === name);
  return module === undefined ? "" : canonicalJson([module.implements, module.tables, module.files]);
}

function modulesDiffer({ first, second }: Sides): readonly string[] {
  const both = first.modules.filter((module) => second.modules.some((other) => other.name === module.name));
  return both
    .filter((module) => moduleShape(first, module.name) !== moduleShape(second, module.name))
    .map((module) => `module ${module.name}: implements or owns differ`);
}

type Placed = Action & { readonly interface: string };

function placed(design: Design): readonly (Placed & Named)[] {
  return actionsOf(design).map((action) => ({ ...action, name: actionName(action) }));
}

function schemasDiffer({ first, second }: Sides): readonly string[] {
  const theirs = placed(second);
  return placed(first).flatMap((action) => {
    const other = theirs.find((each) => each.name === action.name);
    if (other === undefined) {
      return [];
    }
    const sides = [
      { side: "request", differ: canonicalJson(action.request) !== canonicalJson(other.request) },
      { side: "response", differ: canonicalJson(action.response) !== canonicalJson(other.response) },
    ];
    return sides.filter((each) => each.differ).map((each) => `${action.name}: the ${each.side} schemas differ`);
  });
}

function servers(design: Design, condition: string): string {
  const names = placed(design)
    .filter((action) => action.serves.includes(condition))
    .map((action) => action.name)
    .sort();
  return names.length === 0 ? "no action" : names.join(", ");
}

function coverageDiffers(sides: Sides, conditions: readonly string[]): readonly string[] {
  return conditions.flatMap((condition) => {
    const first = servers(sides.first, condition);
    const second = servers(sides.second, condition);
    return first === second ? [] : [`${condition}: served by ${first} in the first, by ${second} in the second`];
  });
}

export function differences(sides: Sides, conditions: readonly string[]): readonly string[] {
  const { first, second } = sides;
  return [
    ...apart("module", { first: first.modules, second: second.modules }),
    ...modulesDiffer(sides),
    ...apart("interface", { first: first.interfaces, second: second.interfaces }),
    ...apart("action", { first: placed(first), second: placed(second) }),
    ...schemasDiffer(sides),
    ...coverageDiffers(sides, conditions),
  ];
}
