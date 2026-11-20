import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { designFolder, designPaths } from "./design-files.ts";
import { actionName, actionsOf, type Action, type Design, type Interface } from "./design-form.ts";

export type Checked = {
  readonly job: string;
  readonly file: string;
  readonly conditions: readonly string[];
  readonly design: Design;
};

type Rule = (checked: Checked) => readonly string[];

type Owned = {
  readonly kind: "table" | "file";
  readonly name: string;
  readonly owners: readonly string[];
};

const vagueWords = ["util", "utils", "helper", "helpers", "common", "manager", "managers", "misc"];

function twice(names: readonly string[]): readonly string[] {
  return [...new Set(names.filter((name, at) => names.indexOf(name) !== at))];
}

function quoted(names: readonly string[]): string {
  return names.map((name) => `"${name}"`).join(" and ");
}

const namesUsedTwice: Rule = ({ design }) => [
  ...twice(design.modules.map((module) => module.name)).map(
    (name) => `The design has two modules named "${name}"; give each module a name of its own.`,
  ),
  ...twice(design.interfaces.map((each) => each.name)).map(
    (name) => `The design has two interfaces named "${name}"; give each interface a name of its own.`,
  ),
  ...design.interfaces.flatMap((each) =>
    twice(each.actions.map((action) => action.name)).map(
      (name) => `The interface "${each.name}" has two actions named "${name}"; give each action a name of its own.`,
    ),
  ),
];

const modulesWithoutInterface: Rule = ({ design }) =>
  design.modules
    .filter((module) => module.implements.length === 0)
    .map(
      (module) =>
        `The module "${module.name}" implements no interface; name in implements the interface it offers, ` +
        "or fold it into a module that has one.",
    );

const interfacesNobodyDefined: Rule = ({ design }) => {
  const defined = design.interfaces.map((each) => each.name);
  return design.modules.flatMap((module) =>
    module.implements
      .filter((name) => !defined.includes(name))
      .map(
        (name) =>
          `The module "${module.name}" implements "${name}", which the design does not define; ` +
          "define that interface or take it out of implements.",
      ),
  );
};

const interfacesNobodyImplements: Rule = ({ design }) => {
  const implemented = design.modules.flatMap((module) => module.implements);
  return design.interfaces
    .filter((each) => !implemented.includes(each.name))
    .map(
      (each) =>
        `The interface "${each.name}" is implemented by no module; ` +
        "add it to implements of the module that offers it.",
    );
};

function ownedOf(design: Design, kind: Owned["kind"]): readonly Owned[] {
  const names = design.modules.flatMap((module) => (kind === "table" ? module.tables : module.files));
  return [...new Set(names)].map((name) => {
    const owners = design.modules.filter((module) => (kind === "table" ? module.tables : module.files).includes(name));
    return { kind, name, owners: owners.map((module) => module.name) };
  });
}

const ownedTwice: Rule = ({ design }) =>
  [...ownedOf(design, "table"), ...ownedOf(design, "file")]
    .filter((owned) => owned.owners.length > 1)
    .map(
      (owned) =>
        `The ${owned.kind} "${owned.name}" is owned by the modules ${quoted(owned.owners)}; ` +
        "let one module own it and the others ask that module.",
    );

const conditionsNotServed: Rule = ({ design, conditions, file }) => {
  const served = actionsOf(design).flatMap((action) => action.serves);
  return conditions
    .filter((condition) => !served.includes(condition))
    .map(
      (condition) =>
        `The condition ${condition} of ${file} is served by no action; ` +
        "name it in serves of the action a person uses for it.",
    );
};

const servesUnknown: Rule = ({ design, conditions, file }) =>
  actionsOf(design).flatMap((action) =>
    action.serves
      .filter((condition) => !conditions.includes(condition))
      .map(
        (condition) =>
          `The action "${actionName(action)}" serves ${condition}, which ${file} does not have; ` +
          "name only conditions the requirements hold.",
      ),
  );

const servesNothing: Rule = ({ design }) =>
  actionsOf(design)
    .filter((action) => action.serves.length === 0 && action.because === undefined)
    .map(
      (action) =>
        `The action "${actionName(action)}" serves no condition and gives no reason in because; ` +
        "name the conditions it serves, or say in because why it exists, such as an operator's need.",
    );

const actionsWithoutExample: Rule = ({ design }) =>
  actionsOf(design)
    .filter((action) => action.examples.length === 0)
    .map(
      (action) =>
        `The action "${actionName(action)}" has no worked example; give at least one: an input, ` +
        "and the exact answer or the exact refusal sentence.",
    );

function earlierUnknown(each: Interface, action: Action): readonly string[] {
  const names = each.actions.map((known) => known.name);
  const called = action.examples.flatMap((example) => example.earlier.map((call) => call.action));
  return [...new Set(called)]
    .filter((name) => !names.includes(name))
    .map(
      (name) =>
        `An example of "${each.name}.${action.name}" calls "${name}" before, which the interface ` +
        `"${each.name}" does not have; name an action of the same interface.`,
    );
}

const earlierCallsUnknown: Rule = ({ design }) =>
  design.interfaces.flatMap((each) => each.actions.flatMap((action) => earlierUnknown(each, action)));

function referencesIn(value: Json): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap(referencesIn);
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  const fields = fieldsOf(value);
  const own = typeof fields.$ref === "string" ? [fields.$ref] : [];
  return [...own, ...Object.values(fields).flatMap(referencesIn)];
}

function siblingFiles(each: Interface): readonly string[] {
  return each.actions.flatMap((action) => [`${action.name}-request.json`, `${action.name}-response.json`]);
}

function isInside(reference: string, each: Interface): boolean {
  const [file = ""] = reference.split("#", 1);
  return reference.startsWith("#") || siblingFiles(each).includes(file);
}

function referencesOutside(each: Interface, action: Action): readonly string[] {
  const sides = [
    { side: "request", schema: action.request },
    { side: "response", schema: action.response },
  ];
  return sides.flatMap(({ side, schema }) =>
    referencesIn(schema)
      .filter((reference) => !isInside(reference, each))
      .map(
        (reference) =>
          `The ${side} schema of "${each.name}.${action.name}" refers to "${reference}"; an interface file refers ` +
          "only to a part of itself (#/...) or to another schema file of its interface, such as add-request.json.",
      ),
  );
}

const schemasReferOutside: Rule = ({ design }) =>
  design.interfaces.flatMap((each) => each.actions.flatMap((action) => referencesOutside(each, action)));

const filesOutsideTheFolder: Rule = ({ design, job }) => {
  const folder = `${designFolder(job)}/`;
  return designPaths(job, design)
    .filter((path) => !path.startsWith(folder) || path.split("/").includes(".."))
    .map(
      (path) =>
        `The design would write ${path}, which is outside ${folder}; name interfaces and actions with ` +
        "lower-case letters, digits and dashes only.",
    );
};

function isVague(name: string): boolean {
  return name.split("-").some((word) => vagueWords.includes(word));
}

const vagueNames: Rule = ({ design }) => [
  ...design.modules
    .filter((module) => isVague(module.name))
    .map(
      (module) =>
        `The module "${module.name}" is not named for what it does; name it for its work (P-36), ` +
        "never utils, helpers, common or manager.",
    ),
  ...design.interfaces
    .filter((each) => isVague(each.name))
    .map(
      (each) =>
        `The interface "${each.name}" is not named for what it does; name it for its work (P-36), ` +
        "never utils, helpers, common or manager.",
    ),
];

const rules: readonly Rule[] = [
  namesUsedTwice,
  modulesWithoutInterface,
  interfacesNobodyDefined,
  interfacesNobodyImplements,
  ownedTwice,
  conditionsNotServed,
  servesUnknown,
  servesNothing,
  actionsWithoutExample,
  earlierCallsUnknown,
  schemasReferOutside,
  filesOutsideTheFolder,
  vagueNames,
];

export const ruleCount = rules.length;

export const heldByRules = ["P-35", "P-36", "P-38", "P-42"];

export function designProblems(checked: Checked): readonly string[] {
  return rules.flatMap((rule) => rule(checked));
}
