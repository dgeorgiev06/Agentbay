import { fieldsOf, pathMatch, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import { listOf, textOf, textsOf } from "./json-values.ts";
import type { PlannedSlice } from "./plan.ts";

export type DesignModule = {
  readonly name: string;
  readonly interfaceFiles: readonly string[];
  readonly files: readonly string[];
};

export type AppliedBy = {
  readonly action: string;
  readonly request: string;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
};

export type CommittedRule = {
  readonly name: string;
  readonly module: string;
  readonly decides: string;
  readonly takes: Json;
  readonly gives: Json;
  readonly appliedBy: readonly AppliedBy[];
};

export type ServingAction = {
  readonly request: string;
  readonly serves: readonly string[];
};

export type DesignSummary = {
  readonly file: string;
  readonly job: string;
  readonly requirements: string;
  readonly schemaFiles: readonly string[];
  readonly modules: readonly DesignModule[];
  readonly rules: readonly CommittedRule[];
  readonly actions: readonly ServingAction[];
};

type Implemented = {
  readonly name: string;
  readonly files: readonly string[];
  readonly applied: readonly { readonly rule: string; readonly by: AppliedBy }[];
  readonly serving: readonly ServingAction[];
};

function filesOf(action: JsonFields): readonly string[] {
  return [textOf(action.request), textOf(action.response)].filter((file) => file !== "");
}

function implementedOf(value: Json): Implemented {
  const fields = fieldsOf(value);
  const name = textOf(fields.name);
  const actions = listOf(fields.actions).map(fieldsOf);
  const applied = actions
    .filter((action) => typeof action.rule === "string")
    .map((action) => ({
      rule: textOf(action.rule),
      by: {
        action: `${name}.${textOf(action.name)}`,
        request: textOf(action.request),
        reads: textsOf(action.reads),
        writes: textsOf(action.writes),
      },
    }));
  const serving = actions.map((action) => ({ request: textOf(action.request), serves: textsOf(action.serves) }));
  return { name, files: actions.flatMap(filesOf), applied, serving };
}

function rulesIn(module: Json, interfaces: readonly Implemented[]): readonly CommittedRule[] {
  const fields = fieldsOf(module);
  const applied = interfaces.flatMap((each) => each.applied);
  return listOf(fields.rules).map((rule) => {
    const named = fieldsOf(rule);
    const name = textOf(named.name);
    return {
      name,
      module: textOf(fields.name),
      decides: textOf(named.decides),
      takes: named.takes ?? [],
      gives: named.gives ?? [],
      appliedBy: applied.filter((each) => each.rule === name).map((each) => each.by),
    };
  });
}

function moduleOf(value: Json, interfaces: readonly Implemented[]): DesignModule {
  const fields = fieldsOf(value);
  const implemented = textsOf(fields.implements);
  const offered = interfaces.filter((each) => implemented.includes(each.name));
  return {
    name: textOf(fields.name),
    interfaceFiles: offered.flatMap((each) => each.files),
    files: textsOf(fieldsOf(fields.owns ?? null).files),
  };
}

export function designSummaryOf(file: string, document: Json): DesignSummary {
  const fields = fieldsOf(document);
  const interfaces = listOf(fields.interfaces).map(implementedOf);
  return {
    file,
    job: textOf(fields.job),
    requirements: textOf(fieldsOf(fields.requirements ?? null).file),
    schemaFiles: interfaces.flatMap((each) => each.files),
    modules: listOf(fields.modules).map((module) => moduleOf(module, interfaces)),
    rules: listOf(fields.modules).flatMap((module) => rulesIn(module, interfaces)),
    actions: interfaces.flatMap((each) => each.serving),
  };
}

export function committedFiles(design: DesignSummary): readonly string[] {
  return [design.file, ...design.schemaFiles];
}

function admits(scope: readonly string[], file: string): boolean {
  return scope.some((pattern) => pathMatch(pattern, file).kind === "matched");
}

export function rulesApplied(named: readonly string[], design: DesignSummary): readonly CommittedRule[] {
  return design.rules
    .map((rule) => ({ ...rule, appliedBy: rule.appliedBy.filter((by) => named.includes(by.request)) }))
    .filter((rule) => rule.appliedBy.length > 0);
}

export function rulesDocument(rules: readonly CommittedRule[]): Json {
  return rules.map((rule) => ({
    name: rule.name,
    module: rule.module,
    decides: rule.decides,
    takes: rule.takes,
    gives: rule.gives,
    appliedBy: rule.appliedBy.map(({ action, reads, writes }) => ({ action, reads: [...reads], writes: [...writes] })),
  }));
}

export function modulesReached(slice: PlannedSlice, design: DesignSummary): readonly string[] {
  const named = slice.interface ?? [];
  const reached = design.modules.filter(
    (module) =>
      module.interfaceFiles.some((file) => named.includes(file)) ||
      module.files.some((file) => admits(slice.scope, file)),
  );
  return reached.map((module) => module.name);
}
