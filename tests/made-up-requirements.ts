import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { ModeFiles } from "./kit-copy.ts";
import { kit } from "./project-fixture.ts";

export type ChecklistVariant =
  | "checks as the base mode does"
  | "finds no id given twice"
  | "counts lines from 0"
  | "checks the rules only when the form passes"
  | "takes no noRefusal"
  | "matches a word inside a longer word";

type Flip = {
  readonly file: string;
  readonly from: string;
  readonly to: string;
};

export const checklist = "checklist";

export const casesCaughtByEachVariant: Readonly<
  Record<Exclude<ChecklistVariant, "checks as the base mode does">, string>
> = {
  "finds no id given twice": "two conditions with one id are refused at the second id's line",
  "counts lines from 0": "a condition with no then is refused at the condition's line",
  "checks the rules only when the form passes":
    "a file with problems of the form and of the rules is refused with every problem at once, each with its line",
  "takes no noRefusal": "a sound file is accepted, and its outcomes and conditions come back as data, each with its id",
  "matches a word inside a longer word": "a vague word or a date that moves inside a longer word is not refused",
};

const baseMode = join(kit, "components", "base", "requirements");

const copiedFiles: readonly string[] = [
  "schemas/file.json",
  "scripts/check.ts",
  "scripts/lib/check.ts",
  "scripts/lib/requirements.ts",
  "scripts/lib/rules.ts",
  "scripts/lib/words.ts",
  "tests/check.example.json",
];

const sharedTestFromTests = "../../../base/interfaces/requirements/tests/shared.ts";

const flips: Readonly<Record<ChecklistVariant, Flip | undefined>> = {
  "checks as the base mode does": undefined,
  "finds no id given twice": {
    file: "scripts/lib/rules.ts",
    from: "if (first === undefined || named.indexOf(first) === index) {",
    to: "if (first !== undefined) {",
  },
  "counts lines from 0": {
    file: "scripts/lib/check.ts",
    from: "line: lineNear(read.lineOf, each.at) }",
    to: "line: (lineNear(read.lineOf, each.at) ?? 1) - 1 }",
  },
  "checks the rules only when the form passes": {
    file: "scripts/lib/check.ts",
    from: "const found = [...form, ...rules];",
    to: "const found = form.length > 0 ? form : rules;",
  },
  "takes no noRefusal": {
    file: "scripts/lib/rules.ts",
    from: "const refuses = outcome.noRefusal || outcome.conditions",
    to: "const refuses = outcome.conditions",
  },
  "matches a word inside a longer word": {
    file: "scripts/lib/rules.ts",
    from: "(?<![\\\\p{L}\\\\p{N}])${escaped}(?![\\\\p{L}\\\\p{N}])",
    to: "${escaped}",
  },
};

function manifestOf(name: string): string {
  const manifest: unknown = parse(readFileSync(join(baseMode, "mode.yaml"), "utf8"));
  assert.ok(typeof manifest === "object" && manifest !== null);
  return stringify({
    ...manifest,
    name,
    description:
      "Checks a requirements file as the kit's requirements mode does; a requirements@1 a test adds to a copy of the kit.",
  });
}

function flipped(file: string, text: string, flip: Flip | undefined): string {
  if (flip === undefined || flip.file !== file) {
    return text;
  }
  assert.ok(text.includes(flip.from), `${file} of the requirements mode no longer holds ${flip.from}`);
  return text.replace(flip.from, flip.to);
}

function modeTest(name: string): string {
  return `import { testRequirements } from "${sharedTestFromTests}";\n\ntestRequirements({ mode: "${name}" });\n`;
}

export function checklistFiles(name: string, variant: ChecklistVariant): ModeFiles {
  const flip = flips[variant];
  const copied = copiedFiles.map(
    (file) => [file, flipped(file, readFileSync(join(baseMode, file), "utf8"), flip)] as const,
  );
  return {
    ...Object.fromEntries(copied),
    "mode.yaml": manifestOf(name),
    "README.md": `# ${name}\n\nChecks a requirements file as the kit's requirements mode does. A test adds it to a copy of the kit.\n`,
    [`tests/${name}.test.ts`]: modeTest(name),
  };
}
