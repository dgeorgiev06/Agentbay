import { fail, fieldsOf, readYaml, segmentsOfPointer, type Json, type ScriptContext } from "../../../../../bay/sdk.ts";
import { requirementsOf, type Path } from "./requirements.ts";
import { brokenRules, type Found } from "./rules.ts";

type LineOf = (path: Path) => number | undefined;

type Placed = {
  readonly found: Found;
  readonly line: number | undefined;
};

type SchemaProblem = {
  readonly path: string;
  readonly message: string;
  readonly fix?: string;
};

const fileSchema = "schemas/file.json";

function lineNear(lineOf: LineOf, at: Path): number | undefined {
  const line = lineOf(at);
  if (line !== undefined || at.length === 0) {
    return line;
  }
  return lineNear(lineOf, at.slice(0, -1));
}

function byLine(first: Placed, second: Placed): number {
  return (first.line ?? 0) - (second.line ?? 0);
}

function problemOf({ found, line }: Placed): Json {
  const problem = { rule: found.rule, sentence: found.sentence };
  return line === undefined ? problem : { rule: found.rule, line, sentence: found.sentence };
}

function refused(file: string, problems: readonly Json[]): Json {
  return { answer: "refused", file, problems };
}

type Read = {
  readonly value: Json;
  readonly lineOf: LineOf;
};

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function valueAt(value: Json, at: Path): Json | undefined {
  return at.reduce<Json | undefined>((inside, segment) => {
    if (isList(inside) && typeof segment === "number") {
      return inside[segment];
    }
    return typeof segment === "string" && inside !== undefined ? fieldsOf(inside)[segment] : undefined;
  }, value);
}

function idNear(value: Json, at: Path): string | undefined {
  const id = fieldsOf(valueAt(value, at) ?? null).id;
  if (typeof id === "string" || at.length === 0) {
    return typeof id === "string" ? id : undefined;
  }
  return idNear(value, at.slice(0, -1));
}

function formFound(value: Json, problem: SchemaProblem): Found {
  const at = segmentsOfPointer(problem.path);
  const said = problem.fix === undefined ? problem.message : `${problem.message} ${problem.fix}`;
  const id = idNear(value, at);
  return { rule: "not the form", at, sentence: id === undefined ? said : `${id}: ${said}` };
}

function samePath(first: Path, second: Path): boolean {
  return first.length === second.length && first.every((segment, index) => segment === second[index]);
}

function refusedByForm(form: readonly Found[], found: Found): boolean {
  return form.some((each) => samePath(each.at, found.at));
}

function answerOf(file: string, read: Read, found: readonly Found[]): Json {
  if (found.length === 0) {
    return { answer: "accepted", file, requirements: read.value };
  }
  const placed = found.map((each) => ({ found: each, line: lineNear(read.lineOf, each.at) }));
  return refused(file, placed.toSorted(byLine).map(problemOf));
}

export async function checkFile(context: ScriptContext, file: string): Promise<Json> {
  const text = await context.files.read(file);
  if (!text.ok) {
    const sentence = `${file} could not be read: ${text.message}`;
    return refused(file, [{ rule: "file not read", sentence }]);
  }
  const read = readYaml(text.value);
  if (!read.ok) {
    const problems = read.problems.map(({ line, message, fix }) => ({
      rule: "not YAML",
      line,
      sentence: `${message} ${fix}`,
    }));
    return refused(file, problems);
  }
  const checked = await context.schemas.check(fileSchema, read.value);
  if (!checked.ok) {
    return fail(checked.message);
  }
  const form = checked.value.passed ? [] : checked.value.problems.map((problem) => formFound(read.value, problem));
  const rules = brokenRules(file, requirementsOf(read.value)).filter((each) => !refusedByForm(form, each));
  const found = [...form, ...rules];
  return answerOf(file, read, found);
}
