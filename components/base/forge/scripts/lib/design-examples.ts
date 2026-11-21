import { fieldsOf, type Json, type ScriptContext } from "../../../../../bay/sdk.ts";
import type { Side } from "./design-files.ts";
import type { Action, Design, Example, Interface } from "./design-form.ts";
import { spelledOut } from "./long-texts.ts";

type SchemaNamed = {
  readonly action: string;
  readonly side: Side;
  readonly schema: Json;
};

export type ExampleCheck = {
  readonly checked: string;
  readonly against: SchemaNamed;
  readonly value: Json;
};

type Misfit = {
  readonly path: string;
  readonly message: string;
  readonly fix?: string;
};

type Fit = { readonly passed: true } | { readonly passed: false; readonly problems: readonly Misfit[] };

export type FitAnswer = { readonly ok: true; readonly value: Fit } | { readonly ok: false; readonly message: string };

export type Answered = {
  readonly check: ExampleCheck;
  readonly answer: FitAnswer;
};

export type ExamplesChecked = {
  readonly problems: readonly string[];
  readonly refusedSchemas: number;
};

type Bundle = {
  readonly ownFile: string;
  readonly siblings: ReadonlyMap<string, Json>;
};

export function referencesIn(value: Json): readonly string[] {
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

function schemaFile(action: Action, side: Side): string {
  return `${action.name}-${side}.json`;
}

export function siblingSchemas(each: Interface): ReadonlyMap<string, Json> {
  return new Map(
    each.actions.flatMap((action) => [
      [schemaFile(action, "request"), action.request],
      [schemaFile(action, "response"), action.response],
    ]),
  );
}

function fileOf(reference: string): string {
  const [file = ""] = reference.split("#", 1);
  return file;
}

function filesNamed(schema: Json | undefined): readonly string[] {
  return referencesIn(schema ?? null)
    .filter((reference) => !reference.startsWith("#"))
    .map(fileOf);
}

function filesNeeded(schema: Json, bundle: Bundle): readonly string[] {
  const needed: string[] = [];
  const waiting = [...filesNamed(schema)];
  for (let index = 0; index < waiting.length; index += 1) {
    const file = waiting[index] ?? "";
    if (file !== bundle.ownFile && !needed.includes(file) && bundle.siblings.has(file)) {
      needed.push(file);
      waiting.push(...filesNamed(bundle.siblings.get(file)));
    }
  }
  return needed;
}

function pointerStep(name: string): string {
  return name.replaceAll("~", "~0").replaceAll("/", "~1");
}

function placeOf(file: string, bundle: Bundle): string | undefined {
  if (file === bundle.ownFile) {
    return "";
  }
  return bundle.siblings.has(file) ? `/$defs/${pointerStep(file)}` : undefined;
}

function referenceIn(reference: string, base: string, bundle: Bundle): string {
  if (reference.startsWith("#")) {
    return `#${base}${reference.slice(1)}`;
  }
  const place = placeOf(fileOf(reference), bundle);
  const fragment = reference.slice(fileOf(reference).length + 1);
  return place === undefined ? reference : `#${place}${fragment}`;
}

function isJsonList(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}

function rewrittenEntry(entry: readonly [string, Json], base: string, bundle: Bundle): readonly [string, Json] {
  const [key, inner] = entry;
  if (key === "$ref" && typeof inner === "string") {
    return [key, referenceIn(inner, base, bundle)];
  }
  return [key, rewritten(inner, base, bundle)];
}

function rewritten(value: Json, base: string, bundle: Bundle): Json {
  if (isJsonList(value)) {
    return value.map((item) => rewritten(item, base, bundle));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(fieldsOf(value)).map((entry) => rewrittenEntry(entry, base, bundle)));
}

export function selfContained(each: Interface, action: Action, side: Side): Json {
  const bundle = { ownFile: schemaFile(action, side), siblings: siblingSchemas(each) };
  const own = rewritten(action[side], "", bundle);
  const needed = filesNeeded(action[side], bundle);
  if (needed.length === 0) {
    return own;
  }
  const fields = fieldsOf(own);
  const parts = needed.map((file): readonly [string, Json] => [
    file,
    rewritten(bundle.siblings.get(file) ?? null, `/$defs/${pointerStep(file)}`, bundle),
  ]);
  return { ...fields, $defs: { ...fieldsOf(fields.$defs ?? null), ...Object.fromEntries(parts) } };
}

function schemaNamed(each: Interface, action: Action, side: Side): SchemaNamed {
  return { action: `${each.name}.${action.name}`, side, schema: selfContained(each, action, side) };
}

type ExampleAt = {
  readonly action: Action;
  readonly example: Example;
  readonly place: string;
};

function earlierChecks(each: Interface, at: ExampleAt): readonly ExampleCheck[] {
  return at.example.earlier.flatMap((call, index) => {
    const called = each.actions.find((action) => action.name === call.action);
    if (called === undefined) {
      return [];
    }
    const checked = `The input of earlier call ${String(index + 1)} in example ${at.place}`;
    return [{ checked, against: schemaNamed(each, called, "request"), value: call.input }];
  });
}

function toldChecks(each: Interface, at: ExampleAt): readonly ExampleCheck[] {
  const { action, example, place } = at;
  if (!("answer" in example.told)) {
    return [];
  }
  return [
    { checked: `The input of example ${place}`, against: schemaNamed(each, action, "request"), value: example.input },
    {
      checked: `The answer of example ${place}`,
      against: schemaNamed(each, action, "response"),
      value: example.told.answer,
    },
  ];
}

function actionChecks(each: Interface, action: Action): readonly ExampleCheck[] {
  return action.examples.flatMap((example, index) => {
    const at = { action, example, place: `${String(index + 1)} of "${each.name}.${action.name}"` };
    return [...earlierChecks(each, at), ...toldChecks(each, at)];
  });
}

function spelledCheck(check: ExampleCheck): readonly ExampleCheck[] {
  const spelled = spelledOut(check.value);
  return spelled.refused.length > 0 ? [] : [{ ...check, value: spelled.value }];
}

export function exampleChecks(design: Design): readonly ExampleCheck[] {
  const checks = design.interfaces.flatMap((each) => each.actions.flatMap((action) => actionChecks(each, action)));
  return checks.flatMap(spelledCheck);
}

export function examplesSpelled(design: Design): number {
  const examples = design.interfaces.flatMap((each) => each.actions.flatMap((action) => action.examples));
  return examples.filter((example) => exampleValues(example).some(({ value }) => spelledOut(value).forms > 0)).length;
}

export function exampleValues(example: Example): readonly { readonly side: string; readonly value: Json }[] {
  const told = "answer" in example.told ? [{ side: "the answer", value: example.told.answer }] : [];
  const earlier = example.earlier.map((call, index) => ({
    side: `the input of earlier call ${String(index + 1)}`,
    value: call.input,
  }));
  return [{ side: "the input", value: example.input }, ...told, ...earlier];
}

function schemaWords(named: SchemaNamed): string {
  return `${named.side} schema of "${named.action}"`;
}

function misfitSentence(check: ExampleCheck, misfit: Misfit): string {
  const where = misfit.path === "" ? "its top" : misfit.path;
  const fix = misfit.fix === undefined ? "" : ` ${misfit.fix}`;
  return `${check.checked} does not fit the ${schemaWords(check.against)}. At ${where}: ${misfit.message}${fix}`;
}

function refusedSentence(named: SchemaNamed, message: string): string {
  const words = schemaWords(named);
  return `The ${words} could not be used, so no example was checked against it. ${message}`;
}

function answerSentences({ check, answer }: Answered): readonly string[] {
  if (!answer.ok) {
    return [refusedSentence(check.against, answer.message)];
  }
  return answer.value.passed ? [] : answer.value.problems.map((misfit) => misfitSentence(check, misfit));
}

export function examplesChecked(answered: readonly Answered[]): ExamplesChecked {
  const refused = answered.filter(({ answer }) => !answer.ok).map(({ check }) => schemaWords(check.against));
  return { problems: [...new Set(answered.flatMap(answerSentences))], refusedSchemas: new Set(refused).size };
}

export async function checkedExamples(context: ScriptContext, design: Design): Promise<ExamplesChecked> {
  const answered = await Promise.all(
    exampleChecks(design).map(async (check) => ({
      check,
      answer: await context.schemas.checkAgainst(check.against.schema, check.value),
    })),
  );
  return examplesChecked(answered);
}
