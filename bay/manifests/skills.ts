import { join } from "node:path/posix";
import type { Mode } from "../generated/mode.ts";
import { parseSkill, readSkill } from "./spec.ts";
import { succeededWith, type Outcome } from "../outcome.ts";
import type { SkillUse, InspectedSkill } from "./manifests.ts";
import { schemaOf } from "./schemas.ts";
import type { ModeSource, Context } from "./loaded.ts";
import { refused } from "./questions.ts";

function skillNamesOf(manifest: Mode): readonly string[] {
  const steps = Object.values(manifest.actions).flatMap((action) => action.run);
  return [...new Set(steps.flatMap((step) => ("skill" in step ? [step.skill] : [])))];
}

export async function skillAnswer(context: Context, mode: ModeSource, name: string): Promise<Outcome<SkillUse>> {
  if (!skillNamesOf(mode.value).includes(name)) {
    return refused(`Mode ${mode.value.name} has no skill ${name}.`);
  }
  const file = join(mode.folder, name, "SKILL.md");
  const parsed = await parseSkill(context.files, file);
  if (!parsed.ok) {
    return parsed;
  }
  const { frontMatter, tools } = parsed.value;
  const outputPath = frontMatter.metadata?.output;
  const outputFile = outputPath === undefined ? undefined : join(mode.folder, outputPath);
  const output =
    outputFile === undefined
      ? undefined
      : schemaOf({ file: outputFile, schemaFile: await context.readSchema(outputFile), label: "output" });
  return succeededWith({ name, file, frontMatter, tools, output });
}

export function inspectedSkill(context: Context, mode: ModeSource): (folder: string) => Promise<InspectedSkill> {
  return async (folder) => {
    const file = join(mode.folder, folder, "SKILL.md");
    return { file, text: await readSkill(context.files, file) };
  };
}
