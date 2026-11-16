import { basename, join, relative } from "node:path/posix";
import { homeFolder, isProjectTheKit, shownPath, type Layout } from "../layout.ts";
import type { FileSystem } from "../ports.ts";
import { failedWith, succeededWith, type Outcome, type Problem } from "../outcome.ts";
import type { NewPart } from "./manifests.ts";
import {
  type TierFolder,
  folderRules,
  modeTiers,
  ownModeTiers,
  ownInterfacesFolder,
  findModeFolders,
} from "./folders.ts";

type NewMode = Extract<NewPart, { readonly mode: string }>;

type NewModePart = Extract<NewPart, { readonly inMode: string }>;

const namePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function partProblem(file: string, message: string, fix: string): Problem {
  return { file, path: "", message, fix };
}

function nameProblems(kind: string, name: string, file: string): readonly Problem[] {
  if (name === "constructor") {
    return [
      partProblem(
        file,
        `The ${kind} name constructor is reserved, because every JavaScript object has it.`,
        "Choose another name.",
      ),
    ];
  }
  if (namePattern.test(name)) {
    return [];
  }
  return [
    partProblem(
      file,
      `The ${kind} name ${JSON.stringify(name)} is not kebab-case.`,
      "Start with a lowercase letter and use only lowercase letters, digits and single dashes, such as daily-digest.",
    ),
  ];
}

function folderInHome(layout: Layout, tier: TierFolder, name: string): string {
  return relative(homeFolder(layout, tier.home), join(tier.folder, name));
}

function tierRefusals(layout: Layout, part: NewMode, folder: string): readonly Problem[] {
  if (part.tier === "modes" || isProjectTheKit(layout)) {
    return [];
  }
  return [
    partProblem(
      folder,
      "Tier base is for the base modes of the kit itself, and this project is not the kit; " +
        "bay new writes only into the project.",
      `Make the mode in this project with --tier modes, or run bay new in the kit's own folder.`,
    ),
  ];
}

async function takenModeProblems(files: FileSystem, layout: Layout, name: string): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const tier of modeTiers(folderRules(layout))) {
    const folder = join(tier.folder, name);
    if (await files.exists(folder)) {
      const shown = shownPath(layout, folder);
      problems.push(
        partProblem(shown, `${shown} already exists; every mode needs its own name.`, "Choose another name."),
      );
    }
  }
  return problems;
}

export async function placeMode(files: FileSystem, layout: Layout, part: NewMode): Promise<Outcome<string>> {
  const rules = folderRules(layout);
  const tier = part.tier === "base" ? rules.base : (rules.projectModes ?? rules.kitModes);
  const folder = folderInHome(layout, tier, part.mode);
  const refusals = [...tierRefusals(layout, part, folder), ...nameProblems("mode", part.mode, folder)];
  if (refusals.length > 0) {
    return failedWith(refusals);
  }
  const taken = await takenModeProblems(files, layout, part.mode);
  return taken.length > 0 ? failedWith(taken) : succeededWith(folder);
}

async function modeToWriteIn(files: FileSystem, layout: Layout, mode: string): Promise<Outcome<string>> {
  const found = (await findModeFolders(files, layout)).find((entry) => basename(entry.folder) === mode);
  if (found === undefined) {
    const where = ownModeTiers(folderRules(layout)).map((tier) => folderInHome(layout, tier, mode));
    return failedWith([
      partProblem(
        "components",
        `There is no mode ${mode}: neither ${where.join(" or ")} has a mode.yaml.`,
        "Name an existing mode, or create it with bay new mode.",
      ),
    ]);
  }
  if (found.home === "kit" && !isProjectTheKit(layout)) {
    const shown = shownPath(layout, found.folder);
    return failedWith([
      partProblem(
        shown,
        `Mode ${mode} lives in the kit (${shown}), and bay new writes only into the project, never into the kit.`,
        "Make a mode of your own with bay new mode, or change the kit's mode in the kit's own folder.",
      ),
    ]);
  }
  return succeededWith(relative(layout.project, found.folder));
}

export async function placeModePart(files: FileSystem, layout: Layout, part: NewModePart): Promise<Outcome<string>> {
  const target = await modeToWriteIn(files, layout, part.inMode);
  const refusals = nameProblems(part.kind, part.name, target.ok ? target.value : part.inMode);
  if (!target.ok || refusals.length > 0) {
    return failedWith([...(target.ok ? [] : target.problems), ...refusals]);
  }
  return target;
}

export function placeInterface(layout: Layout, name: string): Outcome<string> {
  const file = join(relative(layout.project, ownInterfacesFolder(layout)), `${name}.yaml`);
  const refusals = nameProblems("interface", name, file);
  return refusals.length > 0 ? failedWith(refusals) : succeededWith(file);
}
