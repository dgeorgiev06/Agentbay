import { join } from "node:path/posix";
import { checkValue, problemAt } from "./spec.ts";
import type { Problem } from "../outcome.ts";
import { type ModeSource, type Context, shown, settingsOf } from "./loaded.ts";

export async function modeSettingsProblems(context: Context, mode: ModeSource): Promise<readonly Problem[]> {
  const config = context.config;
  const settingsPath = mode.value.settings;
  if (config === undefined || settingsPath === undefined) {
    return [];
  }
  const schemaFile = await context.readSchema(join(mode.folder, settingsPath));
  if (schemaFile.state !== "valid") {
    return [];
  }
  const given = settingsOf(config.value, mode.value.name);
  const check = checkValue(schemaFile.schema, given, { loaded: config, path: ["settings", mode.value.name] });
  if (check.kind === "checked") {
    return check.problems;
  }
  return [
    problemAt(mode, ["settings"], {
      message:
        `Mode ${mode.value.name} names the settings schema ${settingsPath}, ` +
        `which is not a usable JSON Schema: ${check.reason}.`,
      fix: `Correct ${shown(context, join(mode.folder, settingsPath))}.`,
    }),
  ];
}

export function straySettingsProblems(context: Context): readonly Problem[] {
  const config = context.config;
  if (config === undefined) {
    return [];
  }
  return Object.keys(config.value.settings ?? {}).flatMap((modeName) => {
    const mode = context.modes.get(modeName);
    if (context.unloadedModes.has(modeName) || (mode !== undefined && !context.active.has(modeName))) {
      return [];
    }
    if (mode === undefined) {
      return [
        problemAt(config, ["settings", modeName], {
          message: `settings gives settings for ${modeName}, which is not a mode.`,
          fix: `Remove settings.${modeName}, or correct the mode name.`,
        }),
      ];
    }
    if (mode.value.settings === undefined) {
      return [
        problemAt(config, ["settings", modeName], {
          message: `settings gives settings for mode ${modeName}, which declares no settings schema.`,
          fix: `Remove settings.${modeName}, or add settings: <schema file> to the manifest of ${modeName}.`,
        }),
      ];
    }
    return [];
  });
}
