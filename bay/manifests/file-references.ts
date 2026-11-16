import { dirname, join } from "node:path/posix";
import type { Interface } from "../generated/interface.ts";
import type { Step } from "../generated/mode.ts";
import { problemAt, type Loaded, type PathSegments } from "./spec.ts";
import type { Problem } from "../outcome.ts";
import { schemaDirections } from "./schemas.ts";
import {
  type ModeSource,
  type Context,
  type ActionPlace,
  shown,
  actionsOf,
  actionLabel,
  activeModesOf,
} from "./loaded.ts";
import { interfaceReference } from "./interfaces.ts";

type FileReference = {
  readonly kind: "schema" | "file";
  readonly owner: Loaded<unknown>;
  readonly path: PathSegments;
  readonly file: string;
  readonly subject: string;
};

function checkReferences(place: ActionPlace, checks: readonly string[], index: number): readonly FileReference[] {
  return checks.map((check, checkIndex) => ({
    kind: "file",
    owner: place.mode,
    path: ["actions", place.name, "run", index, "checks", checkIndex],
    file: join(place.mode.folder, check),
    subject: `${actionLabel(place)} checks its skill step with the script ${check}`,
  }));
}

function stepReferences(place: ActionPlace, step: Step, index: number): readonly FileReference[] {
  const folder = place.mode.folder;
  if ("script" in step) {
    return [
      {
        kind: "file",
        owner: place.mode,
        path: ["actions", place.name, "run", index, "script"],
        file: join(folder, step.script),
        subject: `${actionLabel(place)} runs the script ${step.script}`,
      },
    ];
  }
  if ("skill" in step) {
    const skill: FileReference = {
      kind: "file",
      owner: place.mode,
      path: ["actions", place.name, "run", index, "skill"],
      file: join(folder, step.skill, "SKILL.md"),
      subject: `${actionLabel(place)} runs the skill ${step.skill}`,
    };
    return [skill, ...checkReferences(place, step.checks ?? [], index)];
  }
  return [];
}

function actionReferences(place: ActionPlace): readonly FileReference[] {
  const schemas = schemaDirections.map((direction) => ({
    kind: "schema" as const,
    owner: place.mode,
    path: ["actions", place.name, direction],
    file: join(place.mode.folder, place.action[direction]),
    subject: `${actionLabel(place)} names the ${direction} schema ${place.action[direction]}`,
  }));
  const steps = place.action.run.flatMap((step, index) => stepReferences(place, step, index));
  return [...schemas, ...steps];
}

function modeReferences(mode: ModeSource): readonly FileReference[] {
  const workflows = (mode.value.workflows ?? []).map((workflow, index) => ({
    kind: "file" as const,
    owner: mode,
    path: ["workflows", index],
    file: join(mode.folder, workflow),
    subject: `Mode ${mode.value.name} lists the workflow ${workflow}`,
  }));
  const settings = mode.value.settings;
  const settingsReference: readonly FileReference[] =
    settings === undefined
      ? []
      : [
          {
            kind: "schema",
            owner: mode,
            path: ["settings"],
            file: join(mode.folder, settings),
            subject: `Mode ${mode.value.name} names the settings schema ${settings}`,
          },
        ];
  return [...actionsOf(mode).flatMap(actionReferences), ...workflows, ...settingsReference];
}

function interfaceReferences(loaded: Loaded<Interface>): readonly FileReference[] {
  const reference = interfaceReference(loaded.value);
  return Object.entries(loaded.value.actions).flatMap(([name, signature]) =>
    schemaDirections.map((direction) => ({
      kind: "schema" as const,
      owner: loaded,
      path: ["actions", name, direction],
      file: join(dirname(loaded.file), signature[direction]),
      subject: `Action ${name} of interface ${reference} names the ${direction} schema ${signature[direction]}`,
    })),
  );
}

async function fileReferenceProblem(context: Context, reference: FileReference): Promise<Problem | undefined> {
  const file = shown(context, reference.file);
  const missing = {
    message: `${reference.subject}, but ${file} does not exist.`,
    fix: `Create ${file}, or correct the path.`,
  };
  if (reference.kind === "file") {
    const exists = await context.files.exists(reference.file);
    return exists ? undefined : problemAt(reference.owner, reference.path, missing);
  }
  const schemaFile = await context.readSchema(reference.file);
  switch (schemaFile.state) {
    case "missing":
      return problemAt(reference.owner, reference.path, missing);
    case "invalid":
      return problemAt(reference.owner, reference.path, {
        message: `${reference.subject}, but ${file} is not valid JSON: ${schemaFile.reason}.`,
        fix: `Correct the JSON in ${file}.`,
      });
    case "valid":
      return undefined;
  }
}

export async function referenceProblems(context: Context): Promise<readonly Problem[]> {
  const references = [
    ...activeModesOf(context).flatMap(modeReferences),
    ...[...context.interfaces.values()].flatMap(interfaceReferences),
  ];
  const problems: Problem[] = [];
  for (const reference of references) {
    const problem = await fileReferenceProblem(context, reference);
    if (problem !== undefined) {
      problems.push(problem);
    }
  }
  return problems;
}
