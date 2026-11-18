import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
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
import { failedWith, type Outcome, type Problem } from "../outcome.ts";
import { emptiedRequiredFields, errorProblems, type Loaded, type PathSegments } from "../value-check.ts";
import { readYaml } from "../yaml-text.ts";
import type { FileSystem } from "../ports.ts";

type Skill = {
  readonly frontMatter: SkillFrontMatter;
  readonly tools: readonly string[];
};

type SkillLine = {
  readonly line: number;
  readonly text: string;
};

type ListItem = SkillLine & {
  readonly entry: string;
};

type SkillSection = {
  readonly heading: string;
  readonly line: number;
  readonly lines: readonly SkillLine[];
  readonly items: readonly ListItem[];
};

export type SkillText = {
  readonly frontMatter: Outcome<SkillFrontMatter>;
  readonly nameLine: number | undefined;
  readonly sections: readonly SkillSection[];
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

function parseSpec<Kind extends keyof Kinds>(source: Source, kind: Kind): Outcome<Loaded<Kinds[Kind]>> {
  const shift = source.firstLine - 1;
  const read = readYaml(source.text);
  if (!read.ok) {
    return failedWith(
      read.problems.map((problem) => ({ file: source.file, path: "", ...problem, line: problem.line + shift })),
    );
  }
  const lineOf = (path: PathSegments): number | undefined => {
    const line = read.lineOf(path);
    return line === undefined ? undefined : line + shift;
  };
  const value: unknown = read.value;
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

const listItemPattern = /^\s*([-*+]|[0-9]+[.)])\s+/;

function entryOf(item: string): string {
  const firstWord = item.replace(listItemPattern, "").trim().split(/\s+/)[0] ?? "";
  return firstWord.replaceAll("`", "").replace(/[:,;.]$/, "");
}

function frontMatterEnd(lines: readonly string[]): number | undefined {
  if (lines[0]?.trim() !== "---") {
    return undefined;
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return closing < 0 ? undefined : closing;
}

function nameLineOf(lines: readonly string[], end: number): number | undefined {
  const index = lines.slice(0, end).findIndex((line) => line.startsWith("name:"));
  return index < 0 ? undefined : index + 1;
}

function levelTwoSections(lines: readonly string[], start: number): readonly SkillSection[] {
  const sections: { heading: string; line: number; lines: SkillLine[]; items: ListItem[] }[] = [];
  let insideFence = false;
  for (const [index, text] of lines.entries()) {
    if (index < start) {
      continue;
    }
    const line = index + 1;
    if (!insideFence && text.startsWith("## ")) {
      sections.push({ heading: text.slice(3).trim(), line, lines: [], items: [] });
      continue;
    }
    if (isFence(text)) {
      insideFence = !insideFence;
    }
    const section = sections.at(-1);
    section?.lines.push({ line, text });
    if (!insideFence && listItemPattern.test(text)) {
      section?.items.push({ line, text, entry: entryOf(text) });
    }
  }
  return sections;
}

const noFrontMatter = {
  path: "",
  line: 1,
  message: "The skill has no front matter between two --- lines at its top.",
  fix: "Start the file with a --- line, then name: and description:, then another --- line.",
};

function skillFrontMatter(file: string, lines: readonly string[], end: number | undefined): Outcome<SkillFrontMatter> {
  if (end === undefined) {
    return failedWith([{ file, ...noFrontMatter }]);
  }
  const frontMatter = parseSpec({ file, text: lines.slice(1, end).join("\n"), firstLine: 2 }, "skill");
  return frontMatter.ok ? { ok: true, value: frontMatter.value.value } : frontMatter;
}

export async function readSkill(files: FileSystem, file: string): Promise<SkillText | undefined> {
  const text = await files.readText(file);
  if (text === undefined) {
    return undefined;
  }
  const lines = text.split(/\r?\n/);
  const end = frontMatterEnd(lines);
  const start = end === undefined ? 0 : end + 1;
  return {
    frontMatter: skillFrontMatter(file, lines, end),
    nameLine: nameLineOf(lines, start),
    sections: levelTwoSections(lines, start),
  };
}

function toolsOf(sections: readonly SkillSection[]): readonly string[] {
  const tools = sections.find((section) => section.heading === "Tools");
  return (tools?.items ?? []).flatMap((item) => (item.entry === "" ? [] : [item.entry]));
}

export async function parseSkill(files: FileSystem, file: string): Promise<Outcome<Skill>> {
  const text = await readSkill(files, file);
  if (text === undefined) {
    return failedWith([missingFile(file)]);
  }
  if (!text.frontMatter.ok) {
    return text.frontMatter;
  }
  return { ok: true, value: { frontMatter: text.frontMatter.value, tools: toolsOf(text.sections) } };
}
