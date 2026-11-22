import assert from "node:assert/strict";
import type { Finding } from "../bay/check-context.ts";
import type { FileListing } from "../bay/ports.ts";
import { checkSystem, type CheckReport } from "../bay/check.ts";
import { layoutOf, type Layout } from "../bay/layout.ts";
import { noProcesses } from "./broker-fixture.ts";
import { fakeFileSystem, fakeInspector, type FakeFileSystem } from "./fakes.ts";
import { layout, paths, rooted, validFiles } from "./system-fixture.ts";

export const notesSkillFile = "components/modes/notes/skills/write-note/SKILL.md";

export const limitsText = [
  "kernel_lines: 4000",
  "adapter_lines: 800",
  "concepts: 5",
  "cli_commands: 12",
  "top_level_folders: 7",
  "",
].join("\n");

export const skillSections = {
  input: ["## Input", "", "One note request, as schemas/add-input.json describes.", ""],
  output: ["## Output", "", "The note, as schemas/add-output.json describes.", ""],
  done: [
    "## Definition of done",
    "",
    "- [DOD-1] (must) The note names its source.",
    "- [DOD-2] (should) It is short.",
    "",
  ],
  instructions: ["## Instructions", "", "1. Read the request.", "2. Write the note.", ""],
  tools: ["## Tools", "", "- `items-store.put`: stores the note", "- add", "- events", ""],
  resources: ["## Resources", "", "- workflows/daily.yaml", ""],
  rules: ["## Rules and constraints", "", "Never invent a source.", ""],
} as const;

export function skillText(sections: readonly (readonly string[])[], name = "write-note"): string {
  const frontMatter = ["---", `name: ${name}`, "description: Writes one note from the input.", "---", ""];
  return [...frontMatter, ...sections.flat()].join("\n");
}

function completeSkill(): string {
  return skillText(Object.values(skillSections));
}

const example = `${JSON.stringify({ input: {}, output: {} })}\n`;

export function cleanFiles(): Record<string, string> {
  return {
    ...validFiles(),
    [notesSkillFile]: completeSkill(),
    "components/base/store/tests/put.example.json": example,
    "components/base/store/tests/get.example.json": example,
    "components/base/store/tests/remove.example.json": example,
    "components/modes/notes/tests/add.example.json": example,
    "components/modes/briefing/tests/digest.example.json": example,
    "framework/limits.yaml": limitsText,
  };
}

export const separate = layoutOf({ kit: "/kit", project: "/project" });

export function separateFiles(project: Readonly<Record<string, string>>): FakeFileSystem {
  const kit = Object.entries(cleanFiles()).filter(
    ([path]) => path !== paths.config && path !== "framework/limits.yaml",
  );
  return fakeFileSystem({
    ...Object.fromEntries(kit.map(([path, text]) => [`/kit/${path}`, text])),
    ...Object.fromEntries(Object.entries(project).map(([path, text]) => [`/project/${path}`, text])),
  });
}

export function listingOf(files: FakeFileSystem): FileListing {
  return {
    projectFiles: (folder) => {
      const prefix = `${folder}/`;
      const paths = [...files.contents.keys()].filter((path) => path.startsWith(prefix));
      return Promise.resolve(paths.map((path) => path.slice(prefix.length)).sort());
    },
  };
}

export async function checkFake(files: FakeFileSystem, checkedLayout: Layout = layout): Promise<CheckReport> {
  return checkSystem(
    {
      files,
      listing: listingOf(files),
      inspector: fakeInspector(files.contents),
      processes: noProcesses,
      searchPath: "",
    },
    checkedLayout,
  );
}

export async function check(files: Readonly<Record<string, string>>): Promise<CheckReport> {
  return checkFake(fakeFileSystem(rooted(files)));
}

function describe(findings: readonly Finding[]): string {
  return JSON.stringify(findings, null, 2);
}

export function findFinding(report: CheckReport, file: string, words: string): Finding {
  const found = report.findings.find((finding) => finding.file === file && finding.message.includes(words));
  assert.ok(found, `no finding in ${file} saying "${words}"; got:\n${describe(report.findings)}`);
  return found;
}

export function assertClean(report: CheckReport): void {
  assert.deepEqual(report.findings, [], describe(report.findings));
}

export function withoutFinding(report: CheckReport, words: string): void {
  const found = report.findings.filter((finding) => finding.message.includes(words));
  assert.deepEqual(found, [], describe(found));
}
