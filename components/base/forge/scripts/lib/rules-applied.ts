import { quoted, twice } from "./card-lines.ts";
import { referencesIn } from "./design-examples.ts";
import {
  actionName,
  actionsOf,
  rulesOf,
  type Action,
  type Design,
  type Module,
  type Rule,
  type Value,
} from "./design-form.ts";

type Placed = Action & { readonly interface: string };

type Kept = Rule & { readonly module: string };

type Applied = {
  readonly action: Placed;
  readonly rule: Kept;
};

type Check = (design: Design) => readonly string[];

type Direction = {
  readonly from: (applied: Applied) => readonly string[];
  readonly missingIn: (applied: Applied) => readonly string[];
  readonly sentence: (applied: Applied, store: string) => string;
};

function offering(design: Design, action: Placed): readonly Module[] {
  return design.modules.filter((module) => module.implements.includes(action.interface));
}

function storesOf(modules: readonly Module[]): readonly string[] {
  return modules.flatMap((module) => [...module.tables, ...module.files]);
}

function storedIn(values: readonly Value[]): readonly string[] {
  return values.flatMap((value) => (value.store === undefined ? [] : [value.store]));
}

function appliedIn(design: Design): readonly Applied[] {
  const rules = rulesOf(design);
  return actionsOf(design).flatMap((action) => {
    const rule = rules.find((kept) => kept.name === action.rule);
    return rule === undefined ? [] : [{ action, rule }];
  });
}

function refuses(action: Action): boolean {
  return action.examples.some((example) => "refusal" in example.told);
}

function unruledWords(action: Action): string {
  const writes = action.writes.length === 0 ? [] : [`writes ${quoted(action.writes)}`];
  return [...writes, ...(refuses(action) ? ["refuses in an example"] : [])].join(" and ");
}

const actionsWithoutRule: Check = (design) =>
  actionsOf(design)
    .filter((action) => action.rule === undefined && (action.writes.length > 0 || refuses(action)))
    .map(
      (action) =>
        `The action "${actionName(action)}" ${unruledWords(action)} but applies no rule; name in rule the pure ` +
        "function that decides what it answers, refuses and writes (P-52).",
    );

const rulesUnknown: Check = (design) => {
  const names = rulesOf(design).map((rule) => rule.name);
  return actionsOf(design)
    .filter((action) => action.rule !== undefined && !names.includes(action.rule))
    .map(
      (action) =>
        `The action "${actionName(action)}" applies the rule "${action.rule ?? ""}", which no module of the design ` +
        "has; add it to rules of the module that offers the action, or name a rule it has.",
    );
};

const rulesOfAnotherModule: Check = (design) =>
  appliedIn(design)
    .filter(({ action, rule }) => {
      const modules = offering(design, action);
      return modules.length > 0 && !modules.some((module) => module.name === rule.module);
    })
    .map(
      ({ action, rule }) =>
        `The action "${actionName(action)}" applies the rule "${rule.name}" of the module "${rule.module}", which ` +
        `does not offer the interface "${action.interface}"; let the module that offers the action hold its rule.`,
    );

function ownerWords(modules: readonly Module[]): string {
  const names = quoted(modules.map((module) => module.name));
  return modules.length === 1 ? `the module ${names} does not own` : `the modules ${names} do not own`;
}

function actionStoresNotOwned(design: Design, action: Placed): readonly string[] {
  const modules = offering(design, action);
  const owned = storesOf(modules);
  if (modules.length === 0) {
    return [];
  }
  const sides = [
    { verb: "reads", stores: action.reads },
    { verb: "writes", stores: action.writes },
  ];
  return sides.flatMap(({ verb, stores }) =>
    stores
      .filter((store) => !owned.includes(store))
      .map(
        (store) =>
          `The action "${actionName(action)}" ${verb} "${store}", which ${ownerWords(modules)}; name only the ` +
          "tables and files of the module that offers it.",
      ),
  );
}

function ruleStoresNotOwned(design: Design, rule: Kept): readonly string[] {
  const owned = storesOf(design.modules.filter((module) => module.name === rule.module));
  const sides = [
    { verb: "takes", values: rule.takes },
    { verb: "gives", values: rule.gives },
  ];
  return sides.flatMap(({ verb, values }) =>
    storedIn(values)
      .filter((store) => !owned.includes(store))
      .map(
        (store) =>
          `The rule "${rule.name}" ${verb} a value stored in "${store}", which the module "${rule.module}" does not ` +
          "own; name only a table or a file of its own module in store.",
      ),
  );
}

const storesNotOwned: Check = (design) => [
  ...actionsOf(design).flatMap((action) => actionStoresNotOwned(design, action)),
  ...rulesOf(design).flatMap((rule) => ruleStoresNotOwned(design, rule)),
];

const directions: readonly Direction[] = [
  {
    from: ({ action }) => action.writes,
    missingIn: ({ rule }) => storedIn(rule.gives),
    sentence: ({ action, rule }, store) =>
      `The action "${actionName(action)}" writes "${store}", which its rule "${rule.name}" does not give; let the ` +
      "rule give everything the action writes, so the thin function around it works nothing out (P-52).",
  },
  {
    from: ({ rule }) => storedIn(rule.gives),
    missingIn: ({ action }) => action.writes,
    sentence: ({ action, rule }, store) =>
      `The rule "${rule.name}" gives a value stored in "${store}", which the action "${actionName(action)}" does ` +
      "not write; name it in writes, or take it out of gives.",
  },
  {
    from: ({ rule }) => storedIn(rule.takes),
    missingIn: ({ action }) => action.reads,
    sentence: ({ action, rule }, store) =>
      `The rule "${rule.name}" takes a value stored in "${store}", which the action "${actionName(action)}" does ` +
      "not read; name it in reads, or take it out of takes.",
  },
  {
    from: ({ action }) => action.reads,
    missingIn: ({ rule }) => storedIn(rule.takes),
    sentence: ({ action, rule }, store) =>
      `The action "${actionName(action)}" reads "${store}", which its rule "${rule.name}" does not take; hand it ` +
      "to the rule, so the thin function decides nothing, or take it out of reads.",
  },
];

const storesApart: Check = (design) =>
  appliedIn(design).flatMap((applied) =>
    directions.flatMap((direction) =>
      [...new Set(direction.from(applied))]
        .filter((store) => !direction.missingIn(applied).includes(store))
        .map((store) => direction.sentence(applied, store)),
    ),
  );

const rulesNobodyApplies: Check = (design) => {
  const applied = actionsOf(design).map((action) => action.rule);
  return rulesOf(design)
    .filter((rule) => !applied.includes(rule.name))
    .map(
      (rule) =>
        `The rule "${rule.name}" of the module "${rule.module}" is applied by no action; name it in rule of the ` +
        "action that applies it, or take it out.",
    );
};

function valuesTwice(rule: Rule): readonly string[] {
  const sides = [
    { verb: "takes", values: rule.takes },
    { verb: "gives", values: rule.gives },
  ];
  return sides.flatMap(({ verb, values }) =>
    twice(values.map((value) => value.name)).map(
      (name) => `The rule "${rule.name}" ${verb} two values named "${name}"; give each value a name of its own.`,
    ),
  );
}

const ruleNamesTwice: Check = (design) => [
  ...twice(rulesOf(design).map((rule) => rule.name)).map(
    (name) => `The design has two rules named "${name}"; give each rule a name of its own.`,
  ),
  ...rulesOf(design).flatMap(valuesTwice),
];

function untouched(design: Design, module: Module): readonly string[] {
  const used = actionsOf(design).flatMap((action) => [...action.reads, ...action.writes]);
  const owned = [
    ...module.tables.map((name) => ({ kind: "table", name })),
    ...module.files.map((name) => ({ kind: "file", name })),
  ];
  return owned
    .filter((store) => !used.includes(store.name))
    .map(
      (store) =>
        `The ${store.kind} "${store.name}" of the module "${module.name}" is read and written by no action; name ` +
        "it in reads or writes of the actions that use it, or take it out of owns.",
    );
}

const storesUntouched: Check = (design) => design.modules.flatMap((module) => untouched(design, module));

function schemaFiles(design: Design, rule: Kept): readonly string[] {
  const offered = design.modules.find((module) => module.name === rule.module)?.implements ?? [];
  return design.interfaces
    .filter((each) => offered.includes(each.name))
    .flatMap((each) =>
      each.actions.flatMap((action) => [
        `schemas/${each.name}/${action.name}-request.json`,
        `schemas/${each.name}/${action.name}-response.json`,
      ]),
    );
}

function isOfItsModule(reference: string, files: readonly string[]): boolean {
  const [file = ""] = reference.split("#", 1);
  return reference.startsWith("#") || files.includes(file);
}

function valueReferences(design: Design, rule: Kept): readonly string[] {
  const files = schemaFiles(design, rule);
  if (files.length === 0) {
    return [];
  }
  return [...rule.takes, ...rule.gives].flatMap((value) =>
    referencesIn(value.schema)
      .filter((reference) => !isOfItsModule(reference, files))
      .map(
        (reference) =>
          `The schema of the value "${value.name}" of the rule "${rule.name}" refers to "${reference}"; a rule's ` +
          "schema refers only to a part of itself (#/...) or to a schema file of an interface its module " +
          "implements, such as schemas/todo/add-request.json.",
      ),
  );
}

const ruleSchemasReferOutside: Check = (design) => rulesOf(design).flatMap((rule) => valueReferences(design, rule));

export const ruleChecks: readonly Check[] = [
  actionsWithoutRule,
  rulesUnknown,
  rulesOfAnotherModule,
  storesNotOwned,
  storesApart,
  rulesNobodyApplies,
  ruleNamesTwice,
  storesUntouched,
  ruleSchemasReferOutside,
];
