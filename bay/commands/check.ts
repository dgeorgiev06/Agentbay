import { checkSystem, summarizeCheck } from "../check.ts";
import type { Invocation, CommandResult } from "../command-context.ts";
import type { Command } from "../command-line.ts";

async function runCheck(invocation: Invocation): Promise<CommandResult> {
  const { ports } = invocation.context;
  const report = await checkSystem({ files: ports.files, listing: ports.listing }, invocation.layout);
  const findings = report.findings.map((finding) => ({
    severity: finding.severity,
    file: finding.file,
    path: finding.path,
    ...(finding.line === undefined ? {} : { line: finding.line }),
    message: finding.message,
    ...(finding.fix === undefined ? {} : { fix: finding.fix }),
  }));
  const json = { ok: report.errors === 0, errors: report.errors, warnings: report.warnings, findings };
  return { exitCode: report.errors > 0 ? 1 : 0, json, text: summarizeCheck(report) };
}

export const checkCommand: Command = {
  name: "check",
  summary: "Check manifests, skills, workflows, imports and limits, and report every problem at once.",
  usage: "check",
  options: [],
  positionals: { least: 0, most: 0 },
  handler: runCheck,
};
