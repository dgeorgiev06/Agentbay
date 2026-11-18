import {
  checkContextOf,
  counted,
  errors,
  isLoaded,
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
import { checkTrust } from "./check-trust.ts";
import { defaultScriptTimeLimitSeconds } from "./contracts.ts";
import { isProjectTheKit, shownPath, type Layout } from "./layout.ts";
import type { Problem } from "./outcome.ts";
import type { FileSystem } from "./ports.ts";
import { inspectSystem } from "./manifests/manifests.ts";
import { readTrustRecord } from "./trust.ts";

export type CheckPorts = {
  readonly files: FileSystem;
  readonly listing: FileListing;
};

export type CheckReport = {
  readonly findings: readonly Finding[];
  readonly errors: number;
  readonly warnings: number;
};

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

function longStepWarning(mode: LoadedModeFolder, action: string, seconds: number): Problem {
  const shown = String(seconds);
  return mode.at(["actions", action, "scriptTimeLimitSeconds"], {
    message:
      `Action ${action} of mode ${mode.manifest.name} declares scriptTimeLimitSeconds: ${shown}, so each of its ` +
      `script steps may run unattended for ${shown} seconds, longer than the kernel's ` +
      `${String(defaultScriptTimeLimitSeconds)}.`,
    fix: "Keep the longer limit only if a step needs it, such as one that runs a whole test suite.",
  });
}

function longStepWarnings(context: CheckContext): readonly Finding[] {
  const found = context.modes.filter(isLoaded).flatMap((mode) =>
    Object.entries(mode.manifest.actions).flatMap(([action, declared]) => {
      const seconds = declared.scriptTimeLimitSeconds;
      const longer = seconds !== undefined && seconds > defaultScriptTimeLimitSeconds;
      return longer ? [longStepWarning(mode, action, seconds)] : [];
    }),
  );
  return warnings(found);
}

function shownFindings(layout: Layout, findings: readonly Finding[]): readonly Finding[] {
  return findings.map((finding) => ({ ...finding, file: shownPath(layout, finding.file) }));
}

export async function checkSystem(ports: CheckPorts, layout: Layout): Promise<CheckReport> {
  const inspection = await inspectSystem(ports.files, layout);
  const context = await checkContextOf({ ...ports, layout, inspection });
  const record = await readTrustRecord(ports.files, layout);
  const findings = shownFindings(layout, [
    ...errors(inspection.problems),
    ...warnings(inspection.notices),
    ...(await checkSkills(context)),
    ...(await checkLayout(context)),
    ...(await checkImports(context)),
    ...(await checkTrust(context, record)),
    ...longStepWarnings(context),
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

export function summarizeCheck(report: CheckReport): string {
  const sorted = [...report.findings].sort(fileOrder(report.findings));
  const totals = `bay check: ${counted(report.errors, "error")}, ${counted(report.warnings, "warning")}.`;
  return [...sorted.flatMap(findingLines), totals].join("\n");
}
