import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type { Answer } from "./answers.ts";
import type { Json } from "./contracts.ts";
import { isRecord } from "./json.ts";
import type { Problem } from "./outcome.ts";
import { deepestNesting, isJson } from "./protocol-json.ts";

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

type ValuePlace = {
  readonly loaded: Loaded<unknown>;
  readonly path: PathSegments;
  readonly whole?: string;
};

type ValueCheck =
  | { readonly kind: "unusable-schema"; readonly reason: string }
  | { readonly kind: "checked"; readonly problems: readonly Problem[] };

export type SchemaParts = Readonly<Record<string, Json>>;

export type UnfollowedReference = {
  readonly clause: string;
  readonly fix: string;
};

export type SchemaFile =
  | { readonly state: "missing" }
  | { readonly state: "invalid"; readonly reason: string }
  | { readonly state: "unfollowed"; readonly references: readonly UnfollowedReference[] }
  | { readonly state: "valid"; readonly schema: Json; readonly parts: SchemaParts };

type ValidSchema = Extract<SchemaFile, { readonly state: "valid" }>;

export type SchemaSource = {
  readonly file: string;
  readonly schemaFile: SchemaFile;
  readonly label: string;
  readonly path: PathSegments;
};

export type SchemaProblem = {
  readonly path: string;
  readonly message: string;
  readonly fix?: string;
};

export type SchemaCheck =
  | { readonly passed: true; readonly value: Json }
  | { readonly passed: false; readonly problems: readonly SchemaProblem[] };

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

function placeName(location: PathSegments, whole = "This file"): string {
  return location.length === 0 ? whole : location.join(".");
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

function describeMaximum(error: ErrorObject, place: string): Wording {
  const limit = numberParameter(error, "limit");
  return { message: `${place} must be at most ${String(limit)}, but it is ${describeValue(error.data)}.` };
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
  ["maximum", describeMaximum],
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

export function emptiedRequiredFields(validate: ValidateFunction, value: unknown): readonly ErrorObject[] {
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
    return describeRequired(required, placeName([...place.path, ...segmentsOf(required.instancePath)], place.whole));
  }
  const describe = describers.get(error.keyword) ?? describeOther;
  return describe(error, placeName([...place.path, ...segmentsOf(error.instancePath)], place.whole));
}

export function errorProblems(
  errors: readonly ErrorObject[],
  place: ValuePlace,
  emptied: readonly ErrorObject[],
): readonly Problem[] {
  return relevantErrors(errors).map((error) => {
    const location = [...place.path, ...segmentsOf(error.instancePath), ...extraSegment(error)];
    return problemAt(place.loaded, location, wording(error, place, emptied));
  });
}

function compileSchema(schema: ValidSchema): ValidateFunction | string {
  if (!isRecord(schema.schema) && typeof schema.schema !== "boolean") {
    return "a JSON Schema must be a mapping, true or false";
  }
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: false, verbose: true, logger: false });
    for (const [name, part] of Object.entries(schema.parts)) {
      if (!isRecord(part) && typeof part !== "boolean") {
        return `the schema ${name} it refers to is not a mapping, true or false`;
      }
      ajv.addSchema(part, name);
    }
    return ajv.compile(schema.schema);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const keptValidators = 256;

const validatorsByContent = new Map<string, ValidateFunction | string>();

function keep(content: string, validate: ValidateFunction | string): void {
  const oldest = validatorsByContent.keys().next();
  if (validatorsByContent.size >= keptValidators && oldest.done !== true) {
    validatorsByContent.delete(oldest.value);
  }
  validatorsByContent.set(content, validate);
}

function validatorFor(schema: ValidSchema): ValidateFunction | string {
  const content = JSON.stringify([schema.schema, schema.parts]);
  const kept = validatorsByContent.get(content);
  if (kept !== undefined) {
    return kept;
  }
  const validate = compileSchema(structuredClone(schema));
  keep(content, validate);
  return validate;
}

function problemsOf(validate: ValidateFunction, value: unknown, place: ValuePlace): readonly Problem[] {
  if (validate(value)) {
    return [];
  }
  const errors = validate.errors ?? [];
  return errorProblems(errors, place, emptiedRequiredFields(validate, value));
}

function endlessReason(error: RangeError): string {
  return (
    `checking a value against it went deeper than the stack allows (${error.message}), ` +
    "as when it refers to itself without stepping into the value"
  );
}

export function checkValue(schema: ValidSchema, value: unknown, place: ValuePlace): ValueCheck {
  const validate = validatorFor(schema);
  if (typeof validate === "string") {
    return { kind: "unusable-schema", reason: validate };
  }
  try {
    return { kind: "checked", problems: problemsOf(validate, value, place) };
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    return { kind: "unusable-schema", reason: endlessReason(error) };
  }
}

export function valueProblems(source: SchemaSource, value: Json): readonly Problem[] {
  const { file, schemaFile, label } = source;
  switch (schemaFile.state) {
    case "missing":
      return [{ file, path: "", message: `The schema file ${file} does not exist, so the ${label} is not checked.` }];
    case "invalid":
      return [{ file, path: "", message: `The schema file ${file} is not valid JSON: ${schemaFile.reason}.` }];
    case "unfollowed":
      return schemaFile.references.map((reference) => ({
        file,
        path: "",
        message: `The schema file ${file} ${reference.clause}.`,
        fix: reference.fix,
      }));
    case "valid": {
      const loaded = { file, value, lineOf: () => undefined };
      const result = checkValue(schemaFile, value, { loaded, path: source.path });
      if (result.kind === "unusable-schema") {
        return [{ file, path: "", message: `The schema file ${file} is not a usable JSON Schema: ${result.reason}.` }];
      }
      return result.problems;
    }
  }
}

function schemaCheckOf(value: Json, problems: readonly Problem[]): SchemaCheck {
  if (problems.length === 0) {
    return { passed: true, value };
  }
  return {
    passed: false,
    problems: problems.map(({ path, message, fix }) =>
      fix === undefined ? { path, message } : { path, message, fix },
    ),
  };
}

export function checkedValue(name: string, schemaFile: SchemaFile, value: Json): SchemaCheck {
  return schemaCheckOf(value, valueProblems({ file: name, schemaFile, label: "value", path: [] }, value));
}

const largestGivenSchema = 65_536;

const mostUnfoldedParts = 65_536;

const referenceKeywords = ["$ref", "$dynamicRef", "$recursiveRef"] as const;

type JsonFields = { readonly [key: string]: Json };

type Mapping = {
  readonly path: PathSegments;
  readonly fields: JsonFields;
};

type Reference = {
  readonly path: PathSegments;
  readonly keyword: (typeof referenceKeywords)[number];
  readonly target: string;
};

type Unfolding = {
  readonly value: Json | undefined;
  readonly followed: readonly string[];
};

function isJsonFields(value: Json | undefined): value is JsonFields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function stepInto(value: Json | undefined, step: string): Json | undefined {
  if (isJsonList(value)) {
    return /^(0|[1-9][0-9]*)$/.test(step) ? value[Number(step)] : undefined;
  }
  return isJsonFields(value) && Object.hasOwn(value, step) ? value[step] : undefined;
}

export function partAt(value: Json, pointer: string): Json | undefined {
  if (pointer === "") {
    return value;
  }
  const steps = pointer
    .slice(1)
    .split("/")
    .map((step) => step.replaceAll("~1", "/").replaceAll("~0", "~"));
  return steps.reduce<Json | undefined>(stepInto, value);
}

function mappingsWithin(value: Json): readonly Mapping[] {
  const mappings: Mapping[] = [];
  const waiting: { readonly path: PathSegments; readonly value: Json }[] = [{ path: [], value }];
  for (let index = 0; index < waiting.length; index += 1) {
    const next = waiting[index];
    if (isJsonList(next?.value)) {
      waiting.push(...next.value.map((item, at) => ({ path: [...next.path, at], value: item })));
    } else if (next !== undefined && isJsonFields(next.value)) {
      mappings.push({ path: next.path, fields: next.value });
      waiting.push(...Object.entries(next.value).map(([key, item]) => ({ path: [...next.path, key], value: item })));
    }
  }
  return mappings;
}

export function referencesWithin(schema: Json): readonly Reference[] {
  return mappingsWithin(schema).flatMap(({ path, fields }) =>
    referenceKeywords.flatMap((keyword) => {
      const target = fields[keyword];
      return typeof target === "string" ? [{ path: [...path, keyword], keyword, target }] : [];
    }),
  );
}

function ownPointer(target: string): string | undefined {
  if (target !== "#" && !target.startsWith("#/")) {
    return undefined;
  }
  try {
    return decodeURIComponent(target.slice(1));
  } catch {
    return undefined;
  }
}

function referenceFault(schema: Json, reference: Reference): string | undefined {
  const { target } = reference;
  const at = pointer(reference.path);
  const own = ownPointer(target);
  if (own === undefined) {
    return (
      `refers to ${target} at ${at}, outside itself; a given schema may refer only to its own parts, ` +
      "written #/<path>, and nothing outside it is read"
    );
  }
  if (partAt(schema, own) === undefined) {
    return `refers to ${target} at ${at}, which names none of its parts; refer to a part it has, such as #/$defs/<name>`;
  }
  return undefined;
}

function innerIdFault(schema: Json): string | undefined {
  const scoped = mappingsWithin(schema).find(({ path, fields }) => path.length > 0 && typeof fields.$id === "string");
  if (scoped === undefined) {
    return undefined;
  }
  return (
    `sets $id at ${pointer(scoped.path)}; a given schema may set $id only at its top, ` +
    "so that each #/ reference names a part of the whole schema"
  );
}

function isReferenceKeyword(key: string): boolean {
  return referenceKeywords.some((keyword) => keyword === key);
}

function followedInPlace(schema: Json, entry: readonly [string, Json], followed: readonly string[]): Unfolding {
  const [key, inner] = entry;
  const target = isReferenceKeyword(key) && typeof inner === "string" ? inner : undefined;
  const own = target === undefined ? undefined : ownPointer(target);
  if (target === undefined || own === undefined || followed.includes(target)) {
    return { value: inner, followed };
  }
  return { value: partAt(schema, own), followed: [...followed, target] };
}

function partsInside(schema: Json, unfolding: Unfolding): readonly Unfolding[] {
  const { value, followed } = unfolding;
  if (isJsonList(value)) {
    return value.map((item) => ({ value: item, followed }));
  }
  if (!isJsonFields(value)) {
    return [];
  }
  return Object.entries(value).map((entry) => followedInPlace(schema, entry, followed));
}

function growsPastLimit(schema: Json): boolean {
  const waiting: Unfolding[] = [{ value: schema, followed: [] }];
  let parts = 0;
  for (let next = waiting.pop(); next !== undefined; next = waiting.pop()) {
    parts += 1;
    if (parts > mostUnfoldedParts) {
      return true;
    }
    waiting.push(...partsInside(schema, next));
  }
  return false;
}

function givenSchemaFault(schema: Json): string | undefined {
  if (!isJson(schema)) {
    return (
      `is nested more than ${String(deepestNesting)} levels deep, deeper than the kernel reads; ` +
      "name deep parts under $defs and refer to them"
    );
  }
  const size = JSON.stringify(schema).length;
  if (size > largestGivenSchema) {
    return (
      `is ${String(size)} characters long as JSON, longer than the ${String(largestGivenSchema)} a given schema ` +
      "may be; make it shorter, such as by naming a repeated part once under $defs"
    );
  }
  const referenceFaults = referencesWithin(schema).flatMap((reference) => referenceFault(schema, reference) ?? []);
  const fault = referenceFaults[0] ?? innerIdFault(schema);
  if (fault !== undefined) {
    return fault;
  }
  if (!growsPastLimit(schema)) {
    return undefined;
  }
  return (
    `grows past ${String(mostUnfoldedParts)} parts when each of its references is followed in place, ` +
    "so checking a value against it could run without end; refer to shared parts from fewer places"
  );
}

function givenRefused(clause: string): Answer<SchemaCheck> {
  return { ok: false, kind: "failed", message: `The schema given ${clause}.` };
}

export function checkedAgainst(schema: Json, value: Json): Answer<SchemaCheck> {
  const fault = givenSchemaFault(schema);
  if (fault !== undefined) {
    return givenRefused(fault);
  }
  const loaded = { file: "", value, lineOf: () => undefined };
  const result = checkValue({ state: "valid", schema, parts: {} }, value, { loaded, path: [], whole: "The value" });
  if (result.kind === "unusable-schema") {
    return givenRefused(`is not a usable JSON Schema: ${result.reason}`);
  }
  return { ok: true, value: schemaCheckOf(value, result.problems) };
}
