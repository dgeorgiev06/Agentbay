import { basename, normalize } from "node:path/posix";
import type { Mode } from "./generated/mode.ts";
import {
  errors,
  isLoaded,
  type CheckContext,
  type Finding,
  type LoadedModeFolder,
  type Wording,
} from "./check-context.ts";
import { pathIn } from "./layout.ts";
import type { InspectedSkill } from "./manifests/manifests.ts";
import type { Problem } from "./outcome.ts";

type SkillText = Exclude<InspectedSkill["text"], undefined>;

type Section = SkillText["sections"][number];

type ListItem = Section["items"][number];

type SkillPlace = {
  readonly mode: LoadedModeFolder;
  readonly folder: string;
  readonly file: string;
};

type AllowedTools = {
  readonly actions: readonly string[];
  readonly interfaceActions: readonly string[];
  readonly openInterfaces: readonly string[];
  readonly resources: readonly string[];
};

const sectionOrder = [
  "Input",
  "Output",
  "Definition of done",
  "Instructions",
  "Tools",
  "Resources",
  "Rules and constraints",
] as const;

const orderText = sectionOrder.join(", ");

const instructionsCap = 150;

const brokerResources = ["db", "files", "secrets", "http", "events"] as const;

const definitionOfDonePattern = /^- \[DOD-([1-9][0-9]*)\] \((must|should|must_not)\) \S/;

function isKnownSection(heading: string): boolean {
  return sectionOrder.some((known) => known === heading);
}

function orderOf(heading: string): number {
  return sectionOrder.findIndex((known) => known === heading);
}

function sectionNamed(skill: SkillText, heading: string): Section | undefined {
  return skill.sections.find((section) => section.heading === heading);
}

function at(place: SkillPlace, line: number | undefined, wording: Wording): Problem {
  return { file: place.file, path: "", ...(line === undefined ? {} : { line }), ...wording };
}

function skillLabel(place: SkillPlace): string {
  return `Skill ${basename(place.folder)} of mode ${place.mode.manifest.name}`;
}

function missingSectionProblems(place: SkillPlace, skill: SkillText): readonly Problem[] {
  return sectionOrder
    .filter((heading) => sectionNamed(skill, heading) === undefined)
    .map((heading) =>
      at(place, undefined, {
        message: `${skillLabel(place)} has no "## ${heading}" section; a skill has the sections ${orderText}.`,
        fix: `Add a "## ${heading}" section in its place in that order.`,
      }),
    );
}

function unknownSectionProblems(place: SkillPlace, skill: SkillText): readonly Problem[] {
  return skill.sections
    .filter((section) => !isKnownSection(section.heading))
    .map((section) =>
      at(place, section.line, {
        message: `${skillLabel(place)} has the section "## ${section.heading}", which is not one of ${orderText}.`,
        fix: "Remove the section or move its text into one of the seven; use ### for a heading inside a section.",
      }),
    );
}

function repeatedSectionProblems(place: SkillPlace, skill: SkillText): readonly Problem[] {
  return skill.sections
    .filter((section, index) => skill.sections.findIndex((other) => other.heading === section.heading) !== index)
    .map((section) =>
      at(place, section.line, {
        message: `${skillLabel(place)} has the section "## ${section.heading}" more than once.`,
        fix: "Merge the two sections into one.",
      }),
    );
}

function outOfOrderProblems(place: SkillPlace, skill: SkillText): readonly Problem[] {
  const problems: Problem[] = [];
  let latest: Section | undefined;
  for (const section of skill.sections.filter((entry) => isKnownSection(entry.heading))) {
    if (latest !== undefined && orderOf(section.heading) < orderOf(latest.heading)) {
      problems.push(
        at(place, section.line, {
          message:
            `${skillLabel(place)} has "## ${section.heading}" after "## ${latest.heading}", ` +
            `but the sections go in the order ${orderText}.`,
          fix: `Move "## ${section.heading}" before "## ${latest.heading}".`,
        }),
      );
      continue;
    }
    latest = section;
  }
  return problems;
}

function hasText(section: Section): boolean {
  return section.lines.some((line) => line.text.trim() !== "");
}

function emptyRulesProblems(place: SkillPlace, skill: SkillText): readonly Problem[] {
  const rules = sectionNamed(skill, "Rules and constraints");
  if (rules === undefined || hasText(rules)) {
    return [];
  }
  return [
    at(place, rules.line, {
      message: `${skillLabel(place)} has an empty "## Rules and constraints" section.`,
      fix: "Write what the skill must never do, at least one line.",
    }),
  ];
}

function definitionOfDoneProblems(place: SkillPlace, skill: SkillText): readonly Problem[] {
  const section = sectionNamed(skill, "Definition of done");
  if (section === undefined) {
    return [];
  }
  const items = section.items;
  if (items.length === 0) {
    return [
      at(place, section.line, {
        message: `${skillLabel(place)} lists no items under "## Definition of done".`,
        fix: 'Add at least one item such as "- [DOD-1] (must) The digest cites every item it names."',
      }),
    ];
  }
  return definitionOfDoneItemProblems(place, items);
}

function definitionOfDoneItemProblems(place: SkillPlace, items: readonly ListItem[]): readonly Problem[] {
  const problems: Problem[] = [];
  const firstLines = new Map<string, number>();
  for (const item of items) {
    const match = definitionOfDonePattern.exec(item.text);
    const identifier = match?.[1];
    if (identifier === undefined) {
      problems.push(
        at(place, item.line, {
          message:
            `${skillLabel(place)} has a Definition of done item that is not in the form ` +
            '"- [DOD-n] (must|should|must_not) text".',
          fix: 'Write it as, for example, "- [DOD-1] (must) The digest cites every item it names."',
        }),
      );
      continue;
    }
    const first = firstLines.get(identifier);
    if (first !== undefined) {
      problems.push(
        at(place, item.line, {
          message:
            `${skillLabel(place)} uses the id DOD-${identifier} twice; ` + `it is first used on line ${String(first)}.`,
          fix: "Give every Definition of done item its own number.",
        }),
      );
      continue;
    }
    firstLines.set(identifier, item.line);
  }
  return problems;
}

function trimmedLength(section: Section): number {
  const filled = section.lines.filter((line) => line.text.trim() !== "");
  const first = filled[0];
  const last = filled.at(-1);
  return first === undefined || last === undefined ? 0 : last.line - first.line + 1;
}

function instructionsProblems(place: SkillPlace, skill: SkillText): readonly Problem[] {
  const section = sectionNamed(skill, "Instructions");
  if (section === undefined) {
    return [];
  }
  const length = trimmedLength(section);
  if (length <= instructionsCap) {
    return [];
  }
  return [
    at(place, section.line, {
      message:
        `${skillLabel(place)} has ${String(length)} lines under "## Instructions", ` +
        `over the cap of ${String(instructionsCap)} lines.`,
      fix:
        `Shorten the Instructions to at most ${String(instructionsCap)} lines; ` +
        "move work that is code into a script step.",
    }),
  ];
}

function entriesOf(skill: SkillText, heading: string): readonly ListItem[] {
  return (sectionNamed(skill, heading)?.items ?? []).filter((item) => item.entry !== "");
}

function declaredResources(mode: Mode): readonly string[] {
  const resources = mode.resources;
  const declared: readonly (readonly [string, boolean])[] = [
    ["db", resources?.db !== undefined],
    ["files", resources?.files !== undefined],
    ["secrets", (resources?.secrets ?? []).length > 0],
    ["http", (resources?.network ?? []).length > 0],
    ["events", true],
  ];
  return declared.filter(([, isDeclared]) => isDeclared).map(([name]) => name);
}

function interfaceNameOf(reference: string): string {
  return reference.slice(0, reference.indexOf("@"));
}

function allowedTools(context: CheckContext, mode: Mode): AllowedTools {
  const required = mode.requires?.interfaces ?? [];
  const interfaceActions = required.flatMap((reference) => {
    const definition = context.interfaces.get(reference);
    const names = definition === undefined ? [] : Object.keys(definition.actions);
    return names.map((action) => `${interfaceNameOf(reference)}.${action}`);
  });
  const openInterfaces = required
    .filter((reference) => !context.interfaces.has(reference))
    .map((reference) => interfaceNameOf(reference));
  return { actions: Object.keys(mode.actions), interfaceActions, openInterfaces, resources: declaredResources(mode) };
}

function isAllowedTool(allowed: AllowedTools, entry: string): boolean {
  const interfaceName = entry.slice(0, entry.indexOf("."));
  return (
    allowed.actions.includes(entry) ||
    allowed.interfaceActions.includes(entry) ||
    (entry.includes(".") && allowed.openInterfaces.includes(interfaceName)) ||
    allowed.resources.includes(entry)
  );
}

function resourceDeclaration(entry: string): string {
  return entry === "http" ? "resources.network (its hosts)" : `resources.${entry}`;
}

function toolProblem(place: SkillPlace, allowed: AllowedTools, item: ListItem): Problem {
  const modeName = place.mode.manifest.name;
  if (brokerResources.some((resource) => resource === item.entry)) {
    const declaration = resourceDeclaration(item.entry);
    return at(place, item.line, {
      message:
        `${skillLabel(place)} lists the broker resource ${item.entry} under Tools, ` +
        `but mode ${modeName} does not declare ${declaration}.`,
      fix: `Declare ${declaration} in the manifest of ${modeName}, or remove ${item.entry} from Tools.`,
    });
  }
  const names = [...allowed.actions, ...allowed.interfaceActions, ...allowed.resources];
  return at(place, item.line, {
    message:
      `${skillLabel(place)} lists ${item.entry} under Tools, which is neither an action of mode ${modeName}, ` +
      `nor interface.action of an interface it requires, nor a broker resource it declares.`,
    fix: `Name one of: ${names.join(", ")}.`,
  });
}

function toolsProblems(context: CheckContext, place: SkillPlace, skill: SkillText): readonly Problem[] {
  const allowed = allowedTools(context, place.mode.manifest);
  return entriesOf(skill, "Tools")
    .filter((item) => !isAllowedTool(allowed, item.entry))
    .map((item) => toolProblem(place, allowed, item));
}

function withoutTrailingSlash(path: string): string {
  return normalize(path).replace(/\/$/, "");
}

function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

function escapes(path: string): boolean {
  return path.startsWith("/") || path.split("/").includes("..");
}

function declaredPaths(mode: Mode): readonly string[] {
  const files = mode.resources?.files;
  return [...(files?.read ?? []), ...(files?.write ?? [])].map(withoutTrailingSlash);
}

function isInsideMode(context: CheckContext, mode: LoadedModeFolder, path: string): boolean {
  const inProject = pathIn(context.layout, "project", path);
  return isUnder(inProject, mode.folder) || mode.files.some((file) => isUnder(file, path));
}

function isAllowedResource(context: CheckContext, mode: LoadedModeFolder, entry: string): boolean {
  if (escapes(entry)) {
    return false;
  }
  const path = withoutTrailingSlash(entry);
  const declared = declaredPaths(mode.manifest);
  return isInsideMode(context, mode, path) || declared.some((folder) => isUnder(path, folder));
}

function resourcesProblems(context: CheckContext, place: SkillPlace, skill: SkillText): readonly Problem[] {
  const modeName = place.mode.manifest.name;
  const declared = declaredPaths(place.mode.manifest);
  const declaredText = declared.length === 0 ? "none" : declared.join(", ");
  return entriesOf(skill, "Resources")
    .filter((item) => !isAllowedResource(context, place.mode, item.entry))
    .map((item) =>
      at(place, item.line, {
        message:
          `${skillLabel(place)} lists the resource ${item.entry}, which is neither a file of the mode folder ` +
          `${place.mode.label} nor inside the paths mode ${modeName} declares in resources.files (${declaredText}).`,
        fix: `Name a file of the mode folder, relative to it, or add the path to resources.files of ${modeName}.`,
      }),
    );
}

function nameProblems(place: SkillPlace, skill: SkillText, name: string): readonly Problem[] {
  const folderName = basename(place.folder);
  if (name === folderName) {
    return [];
  }
  return [
    at(place, skill.nameLine, {
      message: `The skill in ${place.mode.label}/${place.folder} is named ${name}, but its folder is ${folderName}.`,
      fix: `Set name: ${folderName}, or rename the folder to ${name}.`,
    }),
  ];
}

function contentProblems(context: CheckContext, place: SkillPlace, skill: SkillText): readonly Problem[] {
  return [
    ...missingSectionProblems(place, skill),
    ...outOfOrderProblems(place, skill),
    ...unknownSectionProblems(place, skill),
    ...repeatedSectionProblems(place, skill),
    ...emptyRulesProblems(place, skill),
    ...definitionOfDoneProblems(place, skill),
    ...instructionsProblems(place, skill),
    ...toolsProblems(context, place, skill),
    ...resourcesProblems(context, place, skill),
  ];
}

function skillProblems(context: CheckContext, place: SkillPlace, skill: SkillText): readonly Problem[] {
  const frontMatter = skill.frontMatter.ok
    ? nameProblems(place, skill, skill.frontMatter.value.name)
    : skill.frontMatter.problems;
  return [...frontMatter, ...contentProblems(context, place, skill)];
}

function skillFolders(mode: LoadedModeFolder): readonly string[] {
  const fromSteps = Object.values(mode.manifest.actions).flatMap((action) =>
    action.run.flatMap((step) => ("skill" in step ? [withoutTrailingSlash(step.skill)] : [])),
  );
  const fromFolder = mode.files.flatMap((file) => {
    const parts = file.split("/");
    return parts[0] === "skills" && parts.length > 2 ? [`skills/${parts[1] ?? ""}`] : [];
  });
  return [...new Set([...fromSteps, ...fromFolder])].sort();
}

export async function checkSkills(context: CheckContext): Promise<readonly Finding[]> {
  const problems: Problem[] = [];
  for (const mode of context.modes.filter(isLoaded)) {
    for (const folder of skillFolders(mode)) {
      const skill = await mode.skill(folder);
      if (skill.text !== undefined) {
        problems.push(...skillProblems(context, { mode, folder, file: skill.file }, skill.text));
      }
    }
  }
  return errors(problems);
}
