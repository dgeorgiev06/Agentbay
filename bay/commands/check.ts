import { checkSystem, summarizeCheck } from "../check.ts";
import type { Invocation, CommandResult } from "../command-context.ts";

export async function runCheck(invocation: Invocation): Promise<CommandResult> {
  const { ports } = invocation.context;
  const report = await checkSystem(ports, invocation.layout);
  const findings = report.findings.map((finding) => ({
    severity: finding.severity,
    file: finding.file,
    path: finding.path,
    ...(finding.line === undefined ? {} : { line: finding.line }),
    message: finding.message,
    ...(finding.fix === undefined ? {} : { fix: finding.fix }),
  }));
  const { errors, warnings, skillSteps } = report;
  const json = { ok: errors === 0, errors, warnings, skillSteps, findings };
  return { exitCode: errors > 0 ? 1 : 0, json, text: summarizeCheck(report) };
}
