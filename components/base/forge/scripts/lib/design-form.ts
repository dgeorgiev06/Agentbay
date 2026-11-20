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
  readonly because?: string;
  readonly examples: readonly Example[];
};

export type Interface = {
  readonly name: string;
  readonly actions: readonly Action[];
};

export type Module = {
  readonly name: string;
  readonly hides: string;
  readonly implements: readonly string[];
  readonly tables: readonly string[];
  readonly files: readonly string[];
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

function actionOf(value: Json): Action {
  const fields = fieldsOf(value);
  const action = {
    name: textOf(fields.name),
    request: fields.request ?? null,
    response: fields.response ?? null,
    serves: textsOf(fields.serves),
    examples: listOf(fields.examples).map(exampleOf),
  };
  return typeof fields.because === "string" ? { ...action, because: fields.because } : action;
}

function interfaceOf(value: Json): Interface {
  const fields = fieldsOf(value);
  return { name: textOf(fields.name), actions: listOf(fields.actions).map(actionOf) };
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
