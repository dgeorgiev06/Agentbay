import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { isNode, LineCounter, parseDocument } from "yaml";
import configSchema from "../../schemas/config.schema.json" with { type: "json" };
import interfaceSchema from "../../schemas/interface.schema.json" with { type: "json" };
import modeSchema from "../../schemas/mode.schema.json" with { type: "json" };
import skillSchema from "../../schemas/skill.schema.json" with { type: "json" };
import workflowSchema from "../../schemas/workflow.schema.json" with { type: "json" };
import type { Config } from "../generated/config.ts";
import type { Interface } from "../generated/interface.ts";
import type { Mode } from "../generated/mode.ts";
import type { SkillFrontMatter } from "../generated/skill.ts";
import type { Workflow } from "../generated/workflow.ts";
import { isRecord } from "../json.ts";
import { failedWith, type Outcome, type Problem } from "../outcome.ts";
import type { FileSystem } from "../ports.ts";

export type Wording = {
  readonly message: string;
  readonly fix?: string;
};

export type PathSegments = readonly (string | number)[];

export type Loaded<T> = {
  readonly file: string;
  readonly value: T;
  readonly lineOf: (path: PathSegments) => number | undefined;
};

export type ValuePlace = {
  readonly loaded: Loaded<unknown>;
  readonly path: PathSegments;
};

export type ValueCheck =
  | { readonly kind: "unusable-schema"; readonly reason: string }
  | { readonly kind: "checked"; readonly problems: readonly Problem[] };

export type Skill = {
  readonly frontMatter: SkillFrontMatter;
  readonly headings: readonly string[];
};

type Kinds = {
  readonly mode: Mode;
  readonly interface: Interface;
  readonly workflow: Workflow;
  readonly config: Config;
  readonly skill: SkillFrontMatter;
};

type Source = {
  readonly file: string;
  readonly text: string;
  readonly firstLine: number;
};

const ajv = new Ajv2020({ allErrors: true, strict: true, verbose: true });

const validators: { readonly [Kind in keyof Kinds]: ValidateFunction<Kinds[Kind]> } = {
  mode: ajv.compile<Mode>(modeSchema),
  interface: ajv.compile<Interface>(interfaceSchema),
  workflow: ajv.compile<Workflow>(workflowSchema),
  config: ajv.compile<Config>(configSchema),
  skill: ajv.compile<SkillFrontMatter>(skillSchema),
};

function pointer(path: PathSegments): string {
  return path.map((segment) => `/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

function segmentsOf(instancePath: string): readonly string[] {
  if (instancePath === "") {
    return [];
  }
  return instancePath
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

export function problemAt<T>(loaded: Loaded<T>, path: PathSegments, wording: Wording): Problem {
  const line = loaded.lineOf(path);
  return { file: loaded.file, path: pointer(path), ...(line === undefined ? {} : { line }), ...wording };
}

function placeName(location: PathSegments): string {
  return location.length === 0 ? "This file" : location.join(".");
}

function parameter(error: ErrorObject, name: string): unknown {
  const value: unknown = error.params[name];
  return value;
}

function discriminator(branch: unknown): string | undefined {
  if (!isRecord(branch) || !Array.isArray(branch.required)) {
    return undefined;
  }
  const first: unknown = branch.required[0];
  return typeof first === "string" ? first : undefined;
}

function branchDiscriminators(choice: ErrorObject): readonly string[] {
  const branches: unknown = choice.schema;
  if (!Array.isArray(branches)) {
    return [];
  }
  return branches.flatMap((branch: unknown) => discriminator(branch) ?? []);
}

function chosenBranch(choice: ErrorObject): number | undefined {
  const data = choice.data;
  if (!isRecord(data)) {
    return undefined;
  }
  const index = branchDiscriminators(choice).findIndex((field) => field in data);
  return index < 0 ? undefined : index;
}

function hiddenBy(choice: ErrorObject, error: ErrorObject): boolean {
  const inChoice = error === choice || error.schemaPath.startsWith(`${choice.schemaPath}/`);
  if (!inChoice || error.instancePath !== choice.instancePath) {
    return false;
  }
  const branch = chosenBranch(choice);
  if (error === choice) {
    return branch !== undefined;
  }
  return branch === undefined || !error.schemaPath.startsWith(`${choice.schemaPath}/${String(branch)}/`);
}

function relevantErrors(errors: readonly ErrorObject[]): readonly ErrorObject[] {
  const choices = errors.filter((error) => error.keyword === "oneOf");
  return errors
    .filter((error) => error.keyword !== "propertyNames")
    .filter((error) => !choices.some((choice) => hiddenBy(choice, error)));
}

const typeWords: ReadonlyMap<string, string> = new Map([
  ["object", "a YAML mapping (key: value pairs)"],
  ["array", "a list"],
  ["string", "text"],
  ["integer", "a whole number"],
  ["number", "a number"],
  ["boolean", "true or false"],
  ["null", "empty"],
]);

function describeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "empty";
  }
  if (Array.isArray(value)) {
    return "a list";
  }
  if (typeof value === "object") {
    return "a mapping";
  }
  return JSON.stringify(value);
}

function numberParameter(error: ErrorObject, name: string): number {
  const value = parameter(error, name);
  return typeof value === "number" ? value : 0;
}

function describeType(error: ErrorObject, place: string): Wording {
  const expected = String(parameter(error, "type"))
    .split(",")
    .map((type) => typeWords.get(type) ?? type)
    .join(" or ");
  return { message: `${place} must be ${expected}, but it is ${describeValue(error.data)}.` };
}

function fieldDescription(error: ErrorObject, field: string): string | undefined {
  const properties: unknown = error.parentSchema?.properties;
  const property: unknown = isRecord(properties) ? properties[field] : undefined;
  const description: unknown = isRecord(property) ? property.description : undefined;
  return typeof description === "string" ? description : undefined;
}

function describeRequired(error: ErrorObject, place: string): Wording {
  const field = String(parameter(error, "missingProperty"));
  const description = fieldDescription(error, field);
  const expected = description === undefined ? "" : ` Expected: ${description}`;
  return { message: `${place} is missing the required field ${field}.`, fix: `Add ${field}.${expected}` };
}

function describeAdditionalProperty(error: ErrorObject, place: string): Wording {
  const field = String(parameter(error, "additionalProperty"));
  return {
    message: `${place} has the field ${field}, which is not allowed here.`,
    fix: `Remove ${field} or correct its spelling.`,
  };
}

function describeEnum(error: ErrorObject, place: string): Wording {
  const allowed = parameter(error, "allowedValues");
  const values = Array.isArray(allowed) ? allowed.map((value: unknown) => JSON.stringify(value)) : [];
  return { message: `${place} must be one of ${values.join(", ")}, but it is ${describeValue(error.data)}.` };
}

function describePattern(error: ErrorObject, place: string): Wording {
  const description: unknown = error.parentSchema?.description;
  const expected = `Expected: ${String(description)}`;
  if (error.propertyName !== undefined) {
    return { message: `${place} has the key ${error.propertyName}, which is not in the expected form. ${expected}` };
  }
  return { message: `${place} is not in the expected form. ${expected}` };
}

function describeOneOf(error: ErrorObject, place: string): Wording {
  return { message: `${place} must have exactly one of the fields ${branchDiscriminators(error).join(", ")}.` };
}

function describeMinItems(error: ErrorObject, place: string): Wording {
  const limit = numberParameter(error, "limit");
  const entries = limit === 1 ? "entry" : "entries";
  return { message: `${place} must list at least ${String(limit)} ${entries}, but it lists fewer.` };
}

function describeMinLength(error: ErrorObject, place: string): Wording {
  const limit = numberParameter(error, "limit");
  if (limit === 1) {
    return { message: `${place} must not be empty.` };
  }
  return { message: `${place} must be at least ${String(limit)} characters long.` };
}

function describeMinimum(error: ErrorObject, place: string): Wording {
  const limit = numberParameter(error, "limit");
  return { message: `${place} must be at least ${String(limit)}, but it is ${describeValue(error.data)}.` };
}

function describeConst(error: ErrorObject, place: string): Wording {
  const allowed = JSON.stringify(parameter(error, "allowedValue"));
  return { message: `${place} must be ${allowed}, but it is ${describeValue(error.data)}.` };
}

function describeUniqueItems(_error: ErrorObject, place: string): Wording {
  return { message: `${place} lists the same entry twice.`, fix: "Remove the repeated entry." };
}

function describeOther(error: ErrorObject, place: string): Wording {
  return { message: `${place} is not valid (${error.message ?? "no reason given"}).` };
}

const describers: ReadonlyMap<string, (error: ErrorObject, place: string) => Wording> = new Map([
  ["type", describeType],
  ["required", describeRequired],
  ["additionalProperties", describeAdditionalProperty],
  ["enum", describeEnum],
  ["pattern", describePattern],
  ["oneOf", describeOneOf],
  ["minItems", describeMinItems],
  ["minLength", describeMinLength],
  ["minimum", describeMinimum],
  ["const", describeConst],
  ["uniqueItems", describeUniqueItems],
]);

function extraSegment(error: ErrorObject): readonly string[] {
  const extra = parameter(error, "additionalProperty");
  if (error.keyword === "additionalProperties" && typeof extra === "string") {
    return [extra];
  }
  return error.propertyName === undefined ? [] : [error.propertyName];
}

function withoutEmptyFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutEmptyFields);
  }
  if (!isRecord(value)) {
    return value;
  }
  const filled = Object.entries(value).filter(([, field]) => field !== null);
  return Object.fromEntries(filled.map(([key, field]) => [key, withoutEmptyFields(field)]));
}

function emptiedRequiredFields(validate: ValidateFunction, value: unknown): readonly ErrorObject[] {
  validate(withoutEmptyFields(value));
  return (validate.errors ?? []).filter((error) => error.keyword === "required");
}

function fieldPointer(required: ErrorObject): string {
  return `${required.instancePath}${pointer([String(parameter(required, "missingProperty"))])}`;
}

function wording(error: ErrorObject, place: ValuePlace, emptied: readonly ErrorObject[]): Wording {
  const required =
    error.data === null ? emptied.find((entry) => fieldPointer(entry) === error.instancePath) : undefined;
  if (required !== undefined) {
    return describeRequired(required, placeName([...place.path, ...segmentsOf(required.instancePath)]));
  }
  const describe = describers.get(error.keyword) ?? describeOther;
  return describe(error, placeName([...place.path, ...segmentsOf(error.instancePath)]));
}

function errorProblems(
  errors: readonly ErrorObject[],
  place: ValuePlace,
  emptied: readonly ErrorObject[],
): readonly Problem[] {
  return relevantErrors(errors).map((error) => {
    const location = [...place.path, ...segmentsOf(error.instancePath), ...extraSegment(error)];
    return problemAt(place.loaded, location, wording(error, place, emptied));
  });
}

function compileSchema(schema: unknown): ValidateFunction | string {
  if (!isRecord(schema) && typeof schema !== "boolean") {
    return "a JSON Schema must be a mapping, true or false";
  }
  try {
    return new Ajv2020({ allErrors: true, strict: false, verbose: true, logger: false }).compile(schema);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function checkValue(schema: unknown, value: unknown, place: ValuePlace): ValueCheck {
  const validate = compileSchema(schema);
  if (typeof validate === "string") {
    return { kind: "unusable-schema", reason: validate };
  }
  if (validate(value)) {
    return { kind: "checked", problems: [] };
  }
  const errors = validate.errors ?? [];
  return { kind: "checked", problems: errorProblems(errors, place, emptiedRequiredFields(validate, value)) };
}

function parseSpec<Kind extends keyof Kinds>(source: Source, kind: Kind): Outcome<Loaded<Kinds[Kind]>> {
  const lineCounter = new LineCounter();
  const document = parseDocument(source.text, { lineCounter, prettyErrors: false });
  const lineAt = (offset: number): number => lineCounter.linePos(offset).line + source.firstLine - 1;
  const lineOf = (path: PathSegments): number | undefined => {
    const node = document.getIn(path, true);
    return isNode(node) && node.range ? lineAt(node.range[0]) : undefined;
  };
  if (document.errors.length > 0) {
    return failedWith(
      document.errors.map((error) => ({
        file: source.file,
        path: "",
        line: lineAt(error.pos[0]),
        message: `The YAML cannot be read: ${error.message}.`,
        fix: "Correct the YAML syntax at this line.",
      })),
    );
  }
  const value: unknown = document.toJS();
  const validate = validators[kind];
  if (validate(value)) {
    return { ok: true, value: { file: source.file, value, lineOf } };
  }
  const loaded: Loaded<unknown> = { file: source.file, value, lineOf };
  const errors = validate.errors ?? [];
  return failedWith(errorProblems(errors, { loaded, path: [] }, emptiedRequiredFields(validate, value)));
}

function missingFile(file: string): Problem {
  return { file, path: "", message: `The file ${file} does not exist.` };
}

export async function loadSpec<Kind extends keyof Kinds>(
  files: FileSystem,
  file: string,
  kind: Kind,
): Promise<Outcome<Loaded<Kinds[Kind]>>> {
  const text = await files.readText(file);
  if (text === undefined) {
    return failedWith([missingFile(file)]);
  }
  return parseSpec({ file, text, firstLine: 1 }, kind);
}

function isFence(line: string): boolean {
  return line.startsWith("```") || line.startsWith("~~~");
}

function levelTwoHeadings(lines: readonly string[]): readonly string[] {
  const headings: string[] = [];
  let insideFence = false;
  for (const line of lines) {
    if (isFence(line)) {
      insideFence = !insideFence;
    } else if (!insideFence && line.startsWith("## ")) {
      headings.push(line.slice(3).trim());
    }
  }
  return headings;
}

export async function parseSkill(files: FileSystem, file: string): Promise<Outcome<Skill>> {
  const text = await files.readText(file);
  if (text === undefined) {
    return failedWith([missingFile(file)]);
  }
  const lines = text.split(/\r?\n/);
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (lines[0]?.trim() !== "---" || closing < 0) {
    return failedWith([
      {
        file,
        path: "",
        line: 1,
        message: "The skill has no front matter between two --- lines at its top.",
        fix: "Start the file with a --- line, then name: and description:, then another --- line.",
      },
    ]);
  }
  const frontMatter = parseSpec({ file, text: lines.slice(1, closing).join("\n"), firstLine: 2 }, "skill");
  if (!frontMatter.ok) {
    return frontMatter;
  }
  return {
    ok: true,
    value: { frontMatter: frontMatter.value.value, headings: levelTwoHeadings(lines.slice(closing + 1)) },
  };
}
