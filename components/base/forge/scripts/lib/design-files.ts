import { basename } from "node:path/posix";
import type { Json } from "../../../../../bay/sdk.ts";
import type { Written } from "./commit-files.ts";
import { ruleDocument, type Action, type Design, type Example, type Interface, type Module } from "./design-form.ts";

export type Side = "request" | "response";

export type Designed = {
  readonly job: string;
  readonly file: string;
  readonly version: number;
  readonly design: Design;
};

export function designFolder(job: string): string {
  return `docs/designs/${job}`;
}

export function designPath(job: string): string {
  return `${designFolder(job)}/design.yaml`;
}

function schemaEnding(side: Side): string {
  return `-${side}.json`;
}

export function schemaPath(
  job: string,
  at: { readonly interface: string; readonly action: string },
  side: Side,
): string {
  return `${designFolder(job)}/schemas/${at.interface}/${at.action}${schemaEnding(side)}`;
}

export function requestedActionOf(file: string): string | undefined {
  const ending = schemaEnding("request");
  const name = basename(file);
  return name.endsWith(ending) ? name.slice(0, -ending.length) : undefined;
}

function textOfJson(value: Json): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function exampleDocument(example: Example): Json {
  const earlier = example.earlier.length === 0 ? {} : { earlier: example.earlier.map((call) => ({ ...call })) };
  return { ...earlier, input: example.input, ...example.told };
}

function actionDocument(job: string, at: Interface, action: Action): Json {
  const place = { interface: at.name, action: action.name };
  const because = action.because === undefined ? {} : { because: action.because };
  const rule = action.rule === undefined ? {} : { rule: action.rule };
  return {
    name: action.name,
    request: schemaPath(job, place, "request"),
    response: schemaPath(job, place, "response"),
    serves: [...action.serves],
    ...because,
    ...rule,
    reads: [...action.reads],
    writes: [...action.writes],
    examples: action.examples.map(exampleDocument),
  };
}

function moduleDocument(module: Module): Json {
  return {
    name: module.name,
    hides: module.hides,
    implements: [...module.implements],
    owns: { tables: [...module.tables], files: [...module.files] },
    rules: module.rules.map(ruleDocument),
  };
}

function designDocument(designed: Designed): Json {
  const { job, design } = designed;
  return {
    job,
    requirements: { file: designed.file, version: designed.version },
    modules: design.modules.map(moduleDocument),
    interfaces: design.interfaces.map((each) => ({
      name: each.name,
      actions: each.actions.map((action) => actionDocument(job, each, action)),
    })),
  };
}

type SchemaAt = {
  readonly path: string;
  readonly schema: Json;
};

function schemasOf(job: string, design: Design): readonly SchemaAt[] {
  return design.interfaces.flatMap((each) =>
    each.actions.flatMap((action) => {
      const place = { interface: each.name, action: action.name };
      return [
        { path: schemaPath(job, place, "request"), schema: action.request },
        { path: schemaPath(job, place, "response"), schema: action.response },
      ];
    }),
  );
}

export function designPaths(job: string, design: Design): readonly string[] {
  return [designPath(job), ...schemasOf(job, design).map((each) => each.path)];
}

export function designFiles(designed: Designed): readonly Written[] {
  const design = { path: designPath(designed.job), text: textOfJson(designDocument(designed)) };
  const schemas = schemasOf(designed.job, designed.design).map((each) => ({
    path: each.path,
    text: textOfJson(each.schema),
  }));
  return [design, ...schemas];
}
