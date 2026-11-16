import {
  errors,
  isLoaded,
  loadCheckContext,
  warnings,
  type CheckContext,
  type FileListing,
  type Finding,
  type LoadedModeFolder,
} from "./check-context.ts";
import { checkImports, checkKernelImports } from "./check-imports.ts";
import { checkKitLayout, checkLayout } from "./check-layout.ts";
import { checkLimits } from "./check-limits.ts";
import { checkSkills } from "./check-skills.ts";
import { isInsideOrEqual, isProjectTheKit, pathIn, shownPath, type Layout } from "./layout.ts";
import type { FileSystem } from "./ports.ts";
import { basename } from "node:path/posix";
import { inspectSystem } from "./manifests/manifests.ts";
import { problemAt } from "./manifests/spec.ts";
import type { Problem } from "./outcome.ts";

export type CheckPorts = {
  readonly files: FileSystem;
  readonly listing: FileListing;
};

export type CheckReport = {
  readonly findings: readonly Finding[];
  readonly errors: number;
  readonly warnings: number;
};

const baseTier = "components/base";

function commandProblems(mode: LoadedModeFolder): readonly Problem[] {
  const commands = mode.manifest.value.resources?.commands ?? [];
  return commands.map((command, index) =>
    problemAt(mode.manifest, ["resources", "commands", index], {
      message:
        `Mode ${mode.manifest.value.name} lists the command ${command}; ` +
        "a listed command can run code the agent wrote.",
      fix: "Remove the command unless the mode's skills cannot work without it, and review it if it stays.",
    }),
  );
}

function checkBaseCommands(context: CheckContext): readonly Finding[] {
  const base = pathIn(context.layout, "kit", baseTier);
  return context.modes
    .filter(isLoaded)
    .filter((mode) => mode.home === "kit" && isInsideOrEqual(mode.folder, base))
    .flatMap((mode) => warnings(commandProblems(mode)));
}

async function kitFindings(context: CheckContext): Promise<readonly Finding[]> {
  if (!isProjectTheKit(context.layout)) {
    return [];
  }
  return [
    ...checkKitLayout(context.kit),
    ...(await checkKernelImports(context.kit)),
    ...(await checkLimits(context.kit)),
  ];
}

function shownFindings(layout: Layout, findings: readonly Finding[]): readonly Finding[] {
  return findings.map((finding) => ({ ...finding, file: shownPath(layout, finding.file) }));
}

export async function checkSystem(ports: CheckPorts, layout: Layout): Promise<CheckReport> {
  const inspection = await inspectSystem(ports.files, layout);
  const active = inspection.folders
    .filter((folder) => folder.active)
    .map((folder) => folder.manifest?.name ?? basename(folder.folder));
  const context = await loadCheckContext({ ...ports, layout, active: new Set(active) });
  const findings = shownFindings(layout, [
    ...errors(inspection.problems),
    ...warnings(inspection.notices),
    ...(await checkSkills(context)),
    ...(await checkLayout(context)),
    ...(await checkImports(context)),
    ...checkBaseCommands(context),
    ...(await kitFindings(context)),
  ]);
  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  return { findings, errors: errorCount, warnings: findings.length - errorCount };
}

function severityRank(finding: Finding): number {
  return finding.severity === "error" ? 0 : 1;
}

function fileOrder(findings: readonly Finding[]): (first: Finding, second: Finding) => number {
  const filesWithErrors = new Set(
    findings.filter((finding) => finding.severity === "error").map((finding) => finding.file),
  );
  const groupRank = (finding: Finding): number => (filesWithErrors.has(finding.file) ? 0 : 1);
  return (first, second) =>
    groupRank(first) - groupRank(second) ||
    first.file.localeCompare(second.file) ||
    severityRank(first) - severityRank(second) ||
    (first.line ?? 0) - (second.line ?? 0);
}

function place(finding: Finding): string {
  return finding.line === undefined ? finding.file : `${finding.file}:${String(finding.line)}`;
}

function findingLines(finding: Finding): readonly string[] {
  const heading = `${place(finding)}: ${finding.severity}: ${finding.message}`;
  return finding.fix === undefined ? [heading] : [heading, `  fix: ${finding.fix}`];
}

function counted(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

export function summarizeCheck(report: CheckReport): string {
  const sorted = [...report.findings].sort(fileOrder(report.findings));
  const totals = `bay check: ${counted(report.errors, "error")}, ${counted(report.warnings, "warning")}.`;
  return [...sorted.flatMap(findingLines), totals].join("\n");
}
