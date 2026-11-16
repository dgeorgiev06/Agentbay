import type { Json, ModeGrants } from "../contracts.ts";
import type { Config } from "../generated/config.ts";
import type { Interface } from "../generated/interface.ts";
import type { Action, Effect, Mode } from "../generated/mode.ts";
import type { SkillFrontMatter } from "../generated/skill.ts";
import type { Workflow } from "../generated/workflow.ts";
import type { Home, Layout } from "../layout.ts";
import type { FileSystem } from "../ports.ts";
import type { Loaded, PathSegments, SkillText, Wording } from "./spec.ts";
import { failedWith, succeededWith, type Outcome, type Problem } from "../outcome.ts";
import type { KitLayout, ModeTier } from "./folders.ts";
import type { ActionSchemas } from "./schemas.ts";
import { servedReferences } from "./bindings.ts";
import type { LoadedInterface } from "./system.ts";
import { type FolderPlace, type SchemaAgainst, inspect } from "./inspection.ts";
import { placeMode, placeModePart, placeInterface } from "./placement.ts";

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

export async function placeToWrite(files: FileSystem, layout: Layout, part: NewPart): Promise<Outcome<string>> {
  if ("mode" in part) {
    return placeMode(files, layout, part);
  }
  if ("inMode" in part) {
    return placeModePart(files, layout, part);
  }
  return placeInterface(layout, part.interface);
}
