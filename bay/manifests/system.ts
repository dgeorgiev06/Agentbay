import { join } from "node:path/posix";
import type { ModeGrants } from "../contracts.ts";
import type { Config } from "../generated/config.ts";
import type { Interface } from "../generated/interface.ts";
import type { ActiveMode, System } from "./manifests.ts";
import { type ActionSchemas, type SchemaReader, schemaOf } from "./schemas.ts";
import { type ModeSource, type Context, type ModeWorkflow, actionsOf, settingsOf } from "./loaded.ts";
import { answering } from "./questions.ts";
import { skillAnswer } from "./skills.ts";

export type LoadedInterface = {
  readonly file: string;
  readonly definition: Interface;
};

async function actionSchemasOf(
  readSchema: SchemaReader,
  mode: ModeSource,
): Promise<ReadonlyMap<string, ActionSchemas>> {
  const actionSchemas = new Map<string, ActionSchemas>();
  for (const place of actionsOf(mode)) {
    const inputFile = join(mode.folder, place.action.input);
    const outputFile = join(mode.folder, place.action.output);
    actionSchemas.set(place.name, {
      input: schemaOf({ file: inputFile, schemaFile: await readSchema(inputFile), label: "input" }),
      output: schemaOf({ file: outputFile, schemaFile: await readSchema(outputFile), label: "output" }),
    });
  }
  return actionSchemas;
}

type SystemParts = {
  readonly config: Config;
  readonly workflows: readonly ModeWorkflow[];
  readonly granted: ReadonlyMap<string, ModeGrants>;
};

export async function buildSystem(context: Context, parts: SystemParts): Promise<System> {
  const modes = new Map<string, ActiveMode>();
  const inactive = new Set<string>();
  for (const [name, mode] of context.modes) {
    const grants = parts.granted.get(name);
    if (grants === undefined) {
      inactive.add(name);
      continue;
    }
    const own = parts.workflows
      .filter((entry) => entry.mode.value.name === name)
      .map((entry) => [entry.path, entry.loaded.value] as const);
    modes.set(name, {
      home: mode.home,
      folder: mode.folder,
      manifest: mode.value,
      lineOf: mode.lineOf,
      workflows: new Map(own),
      settings: settingsOf(parts.config, name),
      actionSchemas: await actionSchemasOf(context.readSchema, mode),
      grants,
      skill: (skillName) => skillAnswer(context, mode, skillName),
    });
  }
  const interfaces = new Map<string, LoadedInterface>();
  for (const [reference, loaded] of context.interfaces) {
    interfaces.set(reference, { file: loaded.file, definition: loaded.value });
  }
  return answering({ modes, inactive, interfaces, config: parts.config });
}
