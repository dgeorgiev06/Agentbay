import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { isNode, LineCounter, parseDocument } from "yaml";
import configSchema from "../schemas/config.schema.json" with { type: "json" };
import interfaceSchema from "../schemas/interface.schema.json" with { type: "json" };
import modeSchema from "../schemas/mode.schema.json" with { type: "json" };
import skillSchema from "../schemas/skill.schema.json" with { type: "json" };
import workflowSchema from "../schemas/workflow.schema.json" with { type: "json" };
import type { Config } from "./generated/config.ts";
import type { Interface } from "./generated/interface.ts";
import type { Mode } from "./generated/mode.ts";
import type { SkillFrontMatter } from "./generated/skill.ts";
import type { Workflow } from "./generated/workflow.ts";
import type { FileSystem } from "./ports.ts";

export type Problem = {
  readonly file: string;
  readonly path: string;
  readonly line?: number;
  readonly message: string;
  readonly fix?: string;
};

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

export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problems: readonly Problem[] };

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

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function failed(problems: readonly Problem[]): { readonly ok: false; readonly problems: readonly Problem[] } {
  return { ok: false, problems };
}

function placeName(path: readonly string[]): string {
  return path.length === 0 ? "The document" : path.join(".");
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
  return errors.filter((error) => !choices.some((choice) => hiddenBy(choice, error)));
}

function describeError(error: ErrorObject): Wording {
  const place = placeName(segmentsOf(error.instancePath));
  switch (error.keyword) {
    case "required": {
      const field = String(parameter(error, "missingProperty"));
      return { message: `${place} is missing the required field ${field}.`, fix: `Add ${field}.` };
    }
    case "additionalProperties": {
      const field = String(parameter(error, "additionalProperty"));
      return {
        message: `${place} has the field ${field}, which is not allowed here.`,
        fix: `Remove ${field} or correct its spelling.`,
      };
    }
    case "enum": {
      const allowed = parameter(error, "allowedValues");
      const values = Array.isArray(allowed) ? allowed.map((value: unknown) => JSON.stringify(value)) : [];
      return { message: `${place} must be one of ${values.join(", ")}.` };
    }
    case "pattern": {
      const description: unknown = error.parentSchema?.description;
      return { message: `${place} is not in the expected form. Expected: ${String(description)}` };
    }
    case "oneOf":
      return { message: `${place} must have exactly one of the fields ${branchDiscriminators(error).join(", ")}.` };
    default:
      return { message: `${place} ${error.message ?? "is not valid"}.` };
  }
}

function errorPath(error: ErrorObject): readonly string[] {
  const path = segmentsOf(error.instancePath);
  const extra = parameter(error, "additionalProperty");
  return error.keyword === "additionalProperties" && typeof extra === "string" ? [...path, extra] : path;
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
    return failed(
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
  const errors = relevantErrors(validate.errors ?? []);
  return failed(errors.map((error) => problemAt(loaded, errorPath(error), describeError(error))));
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
    return failed([missingFile(file)]);
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
    return failed([missingFile(file)]);
  }
  const lines = text.split(/\r?\n/);
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (lines[0]?.trim() !== "---" || closing < 0) {
    return failed([
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
