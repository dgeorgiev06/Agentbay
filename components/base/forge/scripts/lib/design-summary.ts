import { fieldsOf, pathMatch, type Json } from "../../../../../bay/sdk.ts";
import { listOf, textOf, textsOf } from "./json-values.ts";
import type { PlannedSlice } from "./plan.ts";

export type DesignModule = {
  readonly name: string;
  readonly interfaceFiles: readonly string[];
  readonly files: readonly string[];
};

export type DesignSummary = {
  readonly file: string;
  readonly job: string;
  readonly requirements: string;
  readonly schemaFiles: readonly string[];
  readonly modules: readonly DesignModule[];
};

type Implemented = {
  readonly name: string;
  readonly files: readonly string[];
};

function implementedOf(value: Json): Implemented {
  const fields = fieldsOf(value);
  const actions = listOf(fields.actions).map(fieldsOf);
  const files = actions.flatMap((action) => [textOf(action.request), textOf(action.response)]);
  return { name: textOf(fields.name), files: files.filter((file) => file !== "") };
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
  };
}

export function committedFiles(design: DesignSummary): readonly string[] {
  return [design.file, ...design.schemaFiles];
}

function admits(scope: readonly string[], file: string): boolean {
  return scope.some((pattern) => pathMatch(pattern, file).kind === "matched");
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
