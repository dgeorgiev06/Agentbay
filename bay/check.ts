import {
  checkContextOf,
  counted,
  errors,
  isLoaded,
  warnings,
  type CheckContext,
  type Finding,
  type LoadedModeFolder,
} from "./check-context.ts";
import { grantedFolderFindings } from "./check-granted-folders.ts";
import { checkImports, checkKernelImports } from "./check-imports.ts";
import type { FileListing } from "./ports.ts";
import { checkKitLayout, checkLayout } from "./check-layout.ts";
import { checkLimits } from "./check-limits.ts";
import { checkSkills } from "./check-skills.ts";
import { checkTrust } from "./check-trust.ts";
import { defaultScriptTimeLimitSeconds } from "./contracts.ts";
import { isProjectTheKit, shownPath, type Layout } from "./layout.ts";
import type { Problem } from "./outcome.ts";
import type { FileSystem } from "./ports.ts";
import { inspectOnce, readConfig, skillStepsRunOf, type SkillStepsRun } from "./manifests/manifests.ts";
import { readTrustRecord } from "./trust.ts";

export type CheckPorts = {
  readonly files: FileSystem;
  readonly listing: FileListing;
};

export type CheckReport = {
  readonly findings: readonly Finding[];
  readonly errors: number;
  readonly warnings: number;
  readonly skillSteps: SkillStepsRun;
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

async function skillStepsOf(files: FileSystem, layout: Layout): Promise<SkillStepsRun> {
  const config = await readConfig(files, layout);
  return config.ok ? skillStepsRunOf(config.value) : "with-the-hook";
}

function withoutTheHookWarnings(layout: Layout, skillSteps: SkillStepsRun): readonly Finding[] {
  if (skillSteps === "with-the-hook") {
    return [];
  }
  const warning = {
    file: layout.configFile,
    path: "/skillSteps/run",
    message:
      "Skill steps run without the hook (skillSteps.run: without-the-hook). The kernel takes a skill step's output " +
      "that no hook saw, and the run records that no hook saw it. No hook stops a step's agent from reading or " +
      "writing outside its lists while it works, and the kernel cannot tell an output of the step's agent from one " +
      "the main session handed in.",
    fix:
      "Only the owner changes this. To run with the hook, set skillSteps.run to with-the-hook, run bay build, and " +
      "work in a Claude Code session where the agentbay hook is active.",
  };
  return warnings([warning]);
}

function shownFindings(layout: Layout, findings: readonly Finding[]): readonly Finding[] {
  return findings.map((finding) => ({ ...finding, file: shownPath(layout, finding.file) }));
}

export async function checkSystem(ports: CheckPorts, layout: Layout): Promise<CheckReport> {
  const { inspection, build } = await inspectOnce(ports.files, layout);
  const context = await checkContextOf({ ...ports, layout, inspection });
  const record = await readTrustRecord(ports.files, layout);
  const skillSteps = await skillStepsOf(ports.files, layout);
  const findings = shownFindings(layout, [
    ...errors(inspection.problems),
    ...warnings(inspection.notices),
    ...(await checkSkills(context)),
    ...(await checkLayout(context)),
    ...(await checkImports(context)),
    ...(await checkTrust(context, record)),
    ...longStepWarnings(context),
    ...(await kitFindings(context)),
    ...withoutTheHookWarnings(layout, skillSteps),
    ...(build === undefined ? [] : await grantedFolderFindings({ files: ports.files, layout, system: await build() })),
  ]);
  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  return { findings, errors: errorCount, warnings: findings.length - errorCount, skillSteps };
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

const skillStepsLine: Readonly<Record<SkillStepsRun, string>> = {
  "with-the-hook":
    "Skill steps run with the hook: the kernel takes a skill step's output only when the agentbay hook saw the " +
    "step's agent hand it in.",
  "without-the-hook":
    "Skill steps run without the hook: the kernel takes a skill step's output that no hook saw, and records that no " +
    "hook saw it.",
};

export function summarizeCheck(report: CheckReport): string {
  const sorted = [...report.findings].sort(fileOrder(report.findings));
  const totals = `bay check: ${counted(report.errors, "error")}, ${counted(report.warnings, "warning")}.`;
  return [...sorted.flatMap(findingLines), skillStepsLine[report.skillSteps], totals].join("\n");
}
