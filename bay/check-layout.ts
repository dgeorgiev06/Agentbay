import { join } from "node:path/posix";
import {
  errors,
  filesUnder,
  isLoaded,
  kitInterfacesFolder,
  type CheckContext,
  type Finding,
  type KitTree,
  type LoadedModeFolder,
  type ModeFolder,
} from "./check-context.ts";
import { checkValue, type Wording } from "./spec.ts";
import { isRecord } from "./json.ts";
import type { Problem } from "./outcome.ts";

type JsonFile =
  | { readonly state: "missing" }
  | { readonly state: "read"; readonly value: unknown }
  | { readonly state: "invalid"; readonly reason: string };

type ExamplePlace = {
  readonly mode: LoadedModeFolder;
  readonly action: string;
  readonly file: string;
  readonly label: string;
};

const topLevelFiles = ["mode.yaml", "README.md"] as const;

const topLevelFolders = ["skills", "scripts", "workflows", "schemas", "migrations", "tests"] as const;

const allowedTopLevel = [...topLevelFiles, ...topLevelFolders.map((folder) => `${folder}/`)].join(", ");

const migrationPattern = /^([0-9]{4})-[a-z0-9]+(-[a-z0-9]+)*\.sql$/;

const componentTiers = ["base", "modes"] as const;

function fileProblem(file: string, wording: Wording): Problem {
  return { file, path: "", ...wording };
}

function isAllowedTopLevel(file: string): boolean {
  const [first = "", ...rest] = file.split("/");
  if (rest.length === 0) {
    return topLevelFiles.some((name) => name === first);
  }
  return topLevelFolders.some((name) => name === first);
}

function topLevelProblems(mode: ModeFolder): readonly Problem[] {
  const strays = new Map<string, string>();
  for (const file of mode.files.filter((entry) => !isAllowedTopLevel(entry))) {
    const [first = "", ...rest] = file.split("/");
    const entry = rest.length === 0 ? first : `${first}/`;
    strays.set(entry, join(mode.folder, first));
  }
  return [...strays].map(([entry, path]) =>
    fileProblem(path, {
      message: `The mode folder ${mode.label} holds ${entry}, which the mode-folder layout does not name.`,
      fix: `Move it into one of the entries a mode folder may hold: ${allowedTopLevel}.`,
    }),
  );
}

function skillFolderProblems(mode: ModeFolder): readonly Problem[] {
  const skillFiles = filesUnder(mode.files, "skills");
  const folders = new Set(skillFiles.filter((file) => file.includes("/")).map((file) => file.split("/")[0] ?? ""));
  return [...folders]
    .filter((folder) => !skillFiles.includes(`${folder}/SKILL.md`))
    .map((folder) =>
      fileProblem(join(mode.folder, "skills", folder), {
        message: `The skill folder ${mode.label}/skills/${folder} has no SKILL.md.`,
        fix: `Add ${mode.label}/skills/${folder}/SKILL.md, or remove the folder.`,
      }),
    );
}

function scriptProblems(mode: ModeFolder): readonly Problem[] {
  return filesUnder(mode.files, "scripts")
    .filter((file) => !file.endsWith(".ts"))
    .map((file) =>
      fileProblem(join(mode.folder, "scripts", file), {
        message: `The script folder of ${mode.label} holds ${file}, which is not a .ts file.`,
        fix: "Scripts are TypeScript: rename it to .ts, or move it out of scripts/.",
      }),
    );
}

function migrationNumber(name: string): number | undefined {
  const digits = migrationPattern.exec(name)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

function badMigrationName(mode: ModeFolder, name: string): Problem {
  return fileProblem(join(mode.folder, "migrations", name), {
    message: `The migration ${name} of ${mode.label} is not named NNNN-name.sql.`,
    fix: "Name it with four digits, a dash and a kebab-case name, such as 0001-create-items.sql.",
  });
}

function migrationProblems(mode: ModeFolder): readonly Problem[] {
  const problems: Problem[] = [];
  let previous = 0;
  for (const name of [...filesUnder(mode.files, "migrations")].sort()) {
    const number = migrationNumber(name);
    if (number === undefined) {
      problems.push(badMigrationName(mode, name));
      continue;
    }
    if (number !== previous + 1) {
      const expected = String(previous + 1).padStart(4, "0");
      problems.push(
        fileProblem(join(mode.folder, "migrations", name), {
          message:
            `The migration ${name} of ${mode.label} has the number ${String(number)}, but the next number is ` +
            `${expected}; migration numbers start at 0001 and rise by one, with no gaps or repeats.`,
          fix: `Renumber the migrations so that they run 0001, 0002 and so on.`,
        }),
      );
    }
    previous = number;
  }
  return problems;
}

async function readJson(context: CheckContext, file: string): Promise<JsonFile> {
  const text = await context.files.readText(file);
  if (text === undefined) {
    return { state: "missing" };
  }
  try {
    const value: unknown = JSON.parse(text);
    return { state: "read", value };
  } catch (error) {
    return { state: "invalid", reason: error instanceof Error ? error.message : String(error) };
  }
}

function exampleLabel(place: ExamplePlace): string {
  return `The example ${place.label} of action ${place.action}`;
}

function exampleShapeProblems(place: ExamplePlace, value: unknown): readonly Problem[] {
  if (!isRecord(value)) {
    return [
      fileProblem(place.file, {
        message: `${exampleLabel(place)} is not a JSON object.`,
        fix: 'Write it as { "input": ..., "output": ... }.',
      }),
    ];
  }
  return ["input", "output"]
    .filter((key) => !(key in value))
    .map((key) =>
      fileProblem(place.file, {
        message: `${exampleLabel(place)} has no ${key}.`,
        fix: `Add "${key}": the ${key} of one run of ${place.action}.`,
      }),
    );
}

async function exampleSchemaProblems(
  context: CheckContext,
  place: ExamplePlace,
  example: Readonly<Record<string, unknown>>,
): Promise<readonly Problem[]> {
  const action = place.mode.manifest.value.actions[place.action];
  if (action === undefined) {
    return [];
  }
  const loaded = { file: place.file, value: example, lineOf: () => undefined };
  const problems: Problem[] = [];
  for (const key of ["input", "output"] as const) {
    const schema = await readJson(context, join(place.mode.folder, action[key]));
    if (schema.state !== "read") {
      continue;
    }
    const check = checkValue(schema.value, example[key], { loaded, path: [key] });
    problems.push(...(check.kind === "checked" ? check.problems : []));
  }
  return problems;
}

async function exampleProblems(context: CheckContext, place: ExamplePlace): Promise<readonly Problem[]> {
  const example = await readJson(context, place.file);
  switch (example.state) {
    case "missing":
      return [
        fileProblem(place.file, {
          message:
            `Action ${place.action} of mode ${place.mode.manifest.value.name} has no example: ` +
            `${place.label} does not exist.`,
          fix: 'Add it as { "input": ..., "output": ... }: one input and the output it should give.',
        }),
      ];
    case "invalid":
      return [
        fileProblem(place.file, {
          message: `${exampleLabel(place)} is not valid JSON: ${example.reason}.`,
          fix: `Correct the JSON in ${place.label}.`,
        }),
      ];
    case "read": {
      const shape = exampleShapeProblems(place, example.value);
      if (shape.length > 0 || !isRecord(example.value)) {
        return shape;
      }
      return exampleSchemaProblems(context, place, example.value);
    }
  }
}

async function modeExampleProblems(context: CheckContext, mode: LoadedModeFolder): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const action of Object.keys(mode.manifest.value.actions)) {
    const example = join("tests", `${action}.example.json`);
    const place = { mode, action, file: join(mode.folder, example), label: join(mode.label, example) };
    problems.push(...(await exampleProblems(context, place)));
  }
  return problems;
}

function componentsProblems(paths: readonly string[]): readonly Problem[] {
  const strays = new Set(
    filesUnder(paths, "components")
      .map((file) => file.split("/")[0] ?? "")
      .filter((entry) => !componentTiers.some((tier) => tier === entry)),
  );
  return [...strays].map((entry) =>
    fileProblem(join("components", entry), {
      message: `components/ holds ${entry}, but only base/ and modes/ belong there.`,
      fix: `Move ${entry} into components/base/ or components/modes/, or out of components/.`,
    }),
  );
}

function interfaceEntryProblem(file: string, interfaceNames: readonly string[]): Problem | undefined {
  const [first = "", ...rest] = file.split("/");
  const path = join(kitInterfacesFolder, file);
  if (rest.length === 0) {
    return first.endsWith(".yaml")
      ? undefined
      : fileProblem(path, {
          message: `${kitInterfacesFolder} holds ${first}, which is not an interface .yaml file.`,
          fix: `Move it out of ${kitInterfacesFolder}; the folder holds interface files and their schema folders only.`,
        });
  }
  if (!interfaceNames.includes(first)) {
    return fileProblem(path, {
      message: `${kitInterfacesFolder} has the folder ${first}/, but no interface file ${first}.yaml beside it.`,
      fix: `A schema folder is named after its interface file; rename the folder or add ${first}.yaml.`,
    });
  }
  return file.endsWith(".json")
    ? undefined
    : fileProblem(path, {
        message: `The schema folder ${kitInterfacesFolder}/${first} holds ${rest.join("/")}, which is not a .json schema.`,
        fix: "Keep only JSON Schema files in an interface's schema folder.",
      });
}

function interfacesFolderProblems(paths: readonly string[]): readonly Problem[] {
  const entries = filesUnder(paths, kitInterfacesFolder);
  const interfaceNames = entries
    .filter((file) => !file.includes("/") && file.endsWith(".yaml"))
    .map((file) => file.slice(0, -".yaml".length));
  const problems = entries.flatMap((file) => interfaceEntryProblem(file, interfaceNames) ?? []);
  return [...new Map(problems.map((problem) => [problem.message, problem])).values()];
}

function modeLayoutProblems(mode: ModeFolder): readonly Problem[] {
  return [...topLevelProblems(mode), ...skillFolderProblems(mode), ...scriptProblems(mode), ...migrationProblems(mode)];
}

export async function checkLayout(context: CheckContext): Promise<readonly Finding[]> {
  const problems: Problem[] = [];
  for (const mode of context.modes) {
    problems.push(...modeLayoutProblems(mode));
  }
  for (const mode of context.modes.filter(isLoaded)) {
    problems.push(...(await modeExampleProblems(context, mode)));
  }
  return errors(problems);
}

export function checkKitLayout(kit: KitTree): readonly Finding[] {
  return errors([...componentsProblems(kit.paths), ...interfacesFolderProblems(kit.paths)]);
}
