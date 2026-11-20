import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type { Json } from "./contracts.ts";
import { isRecord } from "./json.ts";
import type { Problem } from "./outcome.ts";

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

export function pointer(path: PathSegments): string {
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

function typeFits(branch: unknown, data: unknown): boolean {
  const type = isRecord(branch) ? branch.type : undefined;
  return (type === "integer" && typeof data === "number") || (type === "string" && typeof data === "string");
}

function typedBranch(choice: ErrorObject): number | undefined {
  const branches: unknown = choice.schema;
  const index = Array.isArray(branches) ? branches.findIndex((branch: unknown) => typeFits(branch, choice.data)) : -1;
  return index < 0 ? undefined : index;
}

function chosenBranch(choice: ErrorObject): number | undefined {
  const data = choice.data;
  if (!isRecord(data)) {
    return typedBranch(choice);
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

function branchTypeWords(choice: ErrorObject): readonly string[] {
  const branches: unknown = choice.schema;
  const types = Array.isArray(branches) ? branches.map((branch: unknown) => (isRecord(branch) ? branch.type : "")) : [];
  return types.flatMap((type) =>
    typeof type === "string" && typeWords.has(type) ? [typeWords.get(type) ?? type] : [],
  );
}

function describeOneOf(error: ErrorObject, place: string): Wording {
  const fields = branchDiscriminators(error);
  if (fields.length > 0) {
    return { message: `${place} must have exactly one of the fields ${fields.join(", ")}.` };
  }
  return {
    message: `${place} must be ${branchTypeWords(error).join(" or ")}, but it is ${describeValue(error.data)}.`,
  };
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

export function schemaCheckOf(value: Json, problems: readonly Problem[]): SchemaCheck {
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
