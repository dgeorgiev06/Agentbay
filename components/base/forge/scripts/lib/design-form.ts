import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { listOf, textOf, textsOf } from "./json-values.ts";

export type Call = {
  readonly action: string;
  readonly input: Json;
};

export type Told = { readonly answer: Json } | { readonly refusal: string };

export type Example = {
  readonly earlier: readonly Call[];
  readonly input: Json;
  readonly told: Told;
};

export type Action = {
  readonly name: string;
  readonly request: Json;
  readonly response: Json;
  readonly serves: readonly string[];
  readonly because?: string | undefined;
  readonly rule?: string | undefined;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly examples: readonly Example[];
};

export type Interface = {
  readonly name: string;
  readonly actions: readonly Action[];
};

export type Value = {
  readonly name: string;
  readonly store?: string | undefined;
  readonly schema: Json;
};

export type Rule = {
  readonly name: string;
  readonly decides: string;
  readonly takes: readonly Value[];
  readonly gives: readonly Value[];
};

export type Module = {
  readonly name: string;
  readonly hides: string;
  readonly implements: readonly string[];
  readonly tables: readonly string[];
  readonly files: readonly string[];
  readonly rules: readonly Rule[];
};

export type DesignerAnswer = {
  readonly id: string;
  readonly sentence: string;
};

export type Design = {
  readonly modules: readonly Module[];
  readonly interfaces: readonly Interface[];
};

function callOf(value: Json): Call {
  const fields = fieldsOf(value);
  return { action: textOf(fields.action), input: fields.input ?? null };
}

function toldOf(value: Json): Told {
  const fields = fieldsOf(value);
  return "answer" in fields ? { answer: fields.answer ?? null } : { refusal: textOf(fields.refusal) };
}

function exampleOf(value: Json): Example {
  const fields = fieldsOf(value);
  return { earlier: listOf(fields.earlier).map(callOf), input: fields.input ?? null, told: toldOf(value) };
}

function optionalText(value: Json | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function actionOf(value: Json): Action {
  const fields = fieldsOf(value);
  return {
    name: textOf(fields.name),
    request: fields.request ?? null,
    response: fields.response ?? null,
    serves: textsOf(fields.serves),
    because: optionalText(fields.because),
    rule: optionalText(fields.rule),
    reads: textsOf(fields.reads),
    writes: textsOf(fields.writes),
    examples: listOf(fields.examples).map(exampleOf),
  };
}

function interfaceOf(value: Json): Interface {
  const fields = fieldsOf(value);
  return { name: textOf(fields.name), actions: listOf(fields.actions).map(actionOf) };
}

function valueOf(value: Json): Value {
  const fields = fieldsOf(value);
  return { name: textOf(fields.name), store: optionalText(fields.store), schema: fields.schema ?? null };
}

function ruleOf(value: Json): Rule {
  const fields = fieldsOf(value);
  return {
    name: textOf(fields.name),
    decides: textOf(fields.decides),
    takes: listOf(fields.takes).map(valueOf),
    gives: listOf(fields.gives).map(valueOf),
  };
}

function moduleOf(value: Json): Module {
  const fields = fieldsOf(value);
  const owns = fieldsOf(fields.owns ?? null);
  return {
    name: textOf(fields.name),
    hides: textOf(fields.hides),
    implements: textsOf(fields.implements),
    tables: textsOf(owns.tables),
    files: textsOf(owns.files),
    rules: listOf(fields.rules).map(ruleOf),
  };
}

export function designOf(value: Json): Design {
  const fields = fieldsOf(value);
  return { modules: listOf(fields.modules).map(moduleOf), interfaces: listOf(fields.interfaces).map(interfaceOf) };
}

export function actionsOf(design: Design): readonly (Action & { readonly interface: string })[] {
  return design.interfaces.flatMap((each) => each.actions.map((action) => ({ ...action, interface: each.name })));
}

export function actionName(action: Action & { readonly interface: string }): string {
  return `${action.interface}.${action.name}`;
}

export function valuesDocument(values: readonly Value[]): Json {
  return values.map((value) => ({
    name: value.name,
    ...(value.store === undefined ? {} : { store: value.store }),
    schema: value.schema,
  }));
}

export function ruleDocument(rule: Rule): Json {
  const { name, decides, takes, gives } = rule;
  return { name, decides, takes: valuesDocument(takes), gives: valuesDocument(gives) };
}

export function rulesOf(design: Design): readonly (Rule & { readonly module: string })[] {
  return design.modules.flatMap((module) => module.rules.map((rule) => ({ ...rule, module: module.name })));
}

export function designerAnswersOf(value: Json): readonly DesignerAnswer[] {
  return listOf(fieldsOf(value).practices).map((said) => ({
    id: textOf(fieldsOf(said).id),
    sentence: textOf(fieldsOf(said).sentence),
  }));
}
