import { basename, join, relative } from "node:path/posix";
import type { Json, ModeGrants } from "../contracts.ts";
import type { Config } from "../generated/config.ts";
import type { Interface } from "../generated/interface.ts";
import type { Action, Effect, Mode } from "../generated/mode.ts";
import type { SkillFrontMatter } from "../generated/skill.ts";
import type { Workflow } from "../generated/workflow.ts";
import { homeFolder, isProjectTheKit, shownPath, type Home, type Layout } from "../layout.ts";
import type { FileSystem } from "../ports.ts";
import type { Loaded, PathSegments, SkillText, Wording } from "./spec.ts";
import { failedWith, succeededWith, type Outcome, type Problem } from "../outcome.ts";
import {
  type KitLayout,
  type ModeTier,
  type TierFolder,
  folderRules,
  modeTiers,
  ownModeTiers,
  ownInterfacesFolder,
  findModeFolders,
} from "./folders.ts";
import type { ActionSchemas } from "./schemas.ts";
import { servedReferences } from "./bindings.ts";
import type { LoadedInterface } from "./system.ts";
import { type FolderPlace, type SchemaAgainst, inspect } from "./inspection.ts";

export type ActiveMode = {
  readonly home: Home;
  readonly folder: string;
  readonly manifest: Mode;
  readonly lineOf: Loaded<Mode>["lineOf"];
  readonly workflows: ReadonlyMap<string, Workflow>;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly actionSchemas: ReadonlyMap<string, ActionSchemas>;
  readonly grants: ModeGrants;
  readonly skill: (name: string) => Promise<Outcome<SkillUse>>;
};

export type SkillUse = {
  readonly name: string;
  readonly file: string;
  readonly frontMatter: SkillFrontMatter;
  readonly tools: readonly string[];
  readonly output: Schema | undefined;
};

export type Schema = {
  readonly file: string;
  readonly json: Json | undefined;
  readonly check: (value: Json) => Outcome<Json>;
};

export type ActionTarget = {
  readonly mode: ActiveMode;
  readonly name: string;
  readonly action: Action;
  readonly caller: string | undefined;
  readonly input: Schema;
  readonly output: Schema;
};

export type WorkflowTarget = {
  readonly mode: ActiveMode;
  readonly path: string;
  readonly workflow: Workflow;
  readonly resolve: (value: Readonly<Record<string, unknown>> | string, scope: ReferenceScope) => Outcome<Json>;
};

export type ReferenceScope = {
  readonly trigger: Json;
  readonly outputs: ReadonlyMap<string, Json>;
  readonly item?: Json;
};

export type System = {
  readonly modes: ReadonlyMap<string, ActiveMode>;
  readonly inactive: ReadonlySet<string>;
  readonly interfaces: ReadonlyMap<string, LoadedInterface>;
  readonly config: Config;
  readonly action: (reference: string, caller?: string) => Outcome<ActionTarget>;
  readonly workflow: (mode: string, path: string) => Outcome<WorkflowTarget>;
  readonly listing: (question: ListingQuestion) => Outcome<ActionsListing>;
};

export type BindingUse = {
  readonly interfaceName: string;
  readonly requirers: readonly string[];
  readonly servedBy: string;
};

export type Inspection = {
  readonly problems: readonly Problem[];
  readonly notices: readonly Problem[];
  readonly folders: readonly InspectedFolder[];
  readonly interfaces: ReadonlyMap<string, Interface>;
  readonly kitLayout: KitLayout;
};

export type InspectedFolder =
  | (FolderPlace & { readonly manifest: undefined })
  | (FolderPlace & {
      readonly manifest: Mode;
      readonly at: (path: PathSegments, wording: Wording) => Problem;
      readonly schemaProblems: (value: unknown, against: SchemaAgainst) => Promise<readonly Problem[]>;
      readonly skill: (folder: string) => Promise<InspectedSkill>;
    });

export type InspectedSkill = {
  readonly file: string;
  readonly text: SkillText | undefined;
};

export type NewPart =
  | { readonly mode: string; readonly tier: ModeTier }
  | { readonly inMode: string; readonly kind: "action" | "skill" | "workflow"; readonly name: string }
  | { readonly interface: string };

export type ModeListed = {
  readonly name: string;
  readonly description: string;
};

export type ActionListed = {
  readonly name: string;
  readonly description: string;
  readonly effects: readonly Effect[];
  readonly input: Json;
};

export type ActionsListing =
  { readonly modes: readonly ModeListed[] } | { readonly mode: string; readonly actions: readonly ActionListed[] };

export type ListingQuestion = {
  readonly mode?: string;
  readonly find?: string;
};

type NewMode = Extract<NewPart, { readonly mode: string }>;

type NewModePart = Extract<NewPart, { readonly inMode: string }>;

const namePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function bindingUses(system: System): readonly BindingUse[] {
  const uses = new Map<string, BindingUse>();
  for (const requirer of [...system.modes.keys()].sort()) {
    for (const [name, servedBy] of servedReferences(system, requirer)) {
      const key = `${name} ${servedBy}`;
      const requirers = uses.get(key)?.requirers ?? [];
      uses.set(key, { interfaceName: name, requirers: [...requirers, requirer], servedBy });
    }
  }
  return [...uses.values()].sort((first, second) => first.interfaceName.localeCompare(second.interfaceName));
}

export async function inspectSystem(files: FileSystem, layout: Layout): Promise<Inspection> {
  return (await inspect(files, layout)).inspection;
}

export async function loadSystem(files: FileSystem, layout: Layout): Promise<Outcome<System>> {
  const { inspection, build } = await inspect(files, layout);
  return build === undefined ? failedWith(inspection.problems) : succeededWith(await build());
}

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

async function placeMode(files: FileSystem, layout: Layout, part: NewMode): Promise<Outcome<string>> {
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

async function placeModePart(files: FileSystem, layout: Layout, part: NewModePart): Promise<Outcome<string>> {
  const target = await modeToWriteIn(files, layout, part.inMode);
  const refusals = nameProblems(part.kind, part.name, target.ok ? target.value : part.inMode);
  if (!target.ok || refusals.length > 0) {
    return failedWith([...(target.ok ? [] : target.problems), ...refusals]);
  }
  return target;
}

function placeInterface(layout: Layout, name: string): Outcome<string> {
  const file = join(relative(layout.project, ownInterfacesFolder(layout)), `${name}.yaml`);
  const refusals = nameProblems("interface", name, file);
  return refusals.length > 0 ? failedWith(refusals) : succeededWith(file);
}

export async function placeToWrite(files: FileSystem, layout: Layout, part: NewPart): Promise<Outcome<string>> {
  if ("mode" in part) {
    return placeMode(files, layout, part);
  }
  if ("inMode" in part) {
    return placeModePart(files, layout, part);
  }
  return placeInterface(layout, part.interface);
}
