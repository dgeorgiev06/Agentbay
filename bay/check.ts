import { join } from "node:path/posix";
import {
  errors,
  isLoaded,
  loadCheckContext,
  rootedFileSystem,
  warnings,
  type CheckContext,
  type Finding,
  type LoadedModeFolder,
} from "./check-context.ts";
import type { FileSystem } from "./ports.ts";
import { loadSystem, type SystemLayout } from "./registry.ts";
import { problemAt, type Problem } from "./spec.ts";

export type FileListing = {
  readonly projectFiles: (root: string) => Promise<readonly string[]>;
};

export type CheckPorts = {
  readonly files: FileSystem;
  readonly listing: FileListing;
};

export type CheckReport = {
  readonly findings: readonly Finding[];
  readonly errors: number;
  readonly warnings: number;
};

const baseTier = "components/base/";

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

function outsideBaseProblems(mode: LoadedModeFolder): readonly Problem[] {
  return commandProblems(mode).map((problem) => ({
    ...problem,
    message: `${problem.message} Only a mode under ${baseTier} may list commands.`,
    fix: `Remove the command from ${join(mode.folder, "mode.yaml")}; a skill step's checks belong in script steps.`,
  }));
}

function checkCommands(context: CheckContext): readonly Finding[] {
  return context.modes.filter(isLoaded).flatMap((mode) => {
    const isBase = mode.folder.startsWith(baseTier);
    return isBase ? warnings(commandProblems(mode)) : errors(outsideBaseProblems(mode));
  });
}

async function registryFindings(ports: CheckPorts, layout: SystemLayout): Promise<readonly Finding[]> {
  const outcome = await loadSystem(ports.files, layout);
  return outcome.ok ? [] : errors(outcome.problems);
}

export async function checkSystem(ports: CheckPorts, layout: SystemLayout): Promise<CheckReport> {
  const files = rootedFileSystem(ports.files, layout.root);
  const paths = await ports.listing.projectFiles(layout.root);
  const context = await loadCheckContext(files, paths);
  const findings = [...(await registryFindings(ports, layout)), ...checkCommands(context)];
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
