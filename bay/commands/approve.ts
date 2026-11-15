import { refusedResult, usageResult, withKernel, type CommandResult, type Invocation } from "../command-context.ts";
import type { Command } from "../command-line.ts";
import type { Kernel } from "../kernel.ts";
import { engineOutput } from "../run-report.ts";
import { storedWaiting } from "../waiting.ts";

type Channel = { readonly via: "terminal" } | { readonly via: "chat"; readonly quote: string };

type ApprovalRequest = {
  readonly invocation: Invocation;
  readonly kernel: Kernel;
  readonly channel: Channel;
  readonly decision: Decision;
};

type Decision = {
  readonly runId: string;
  readonly stepKey: string;
  readonly hash: string;
  readonly decision: "approve" | "reject";
};

const usage =
  'approve <run> <stepKey> --hash <hash> [--reject] [--via terminal | --via chat --quote "<the owner\'s words>"]';

function channelOf(invocation: Invocation): Channel | string {
  const via = invocation.values.get("via") ?? "terminal";
  const quote = invocation.values.get("quote")?.trim();
  switch (via) {
    case "terminal":
      return quote === undefined ? { via } : "--quote goes with --via chat; a terminal approval needs no quote.";
    case "chat":
      return quote === undefined || quote === ""
        ? '--via chat needs --quote "<the owner\'s exact words>".'
        : { via, quote };
    default:
      return `--via is terminal or chat, not ${via}.`;
  }
}

function allowedChannels(kernel: Kernel): readonly string[] {
  return kernel.system.config.approvals?.from ?? ["terminal"];
}

async function shownText(kernel: Kernel, decision: Decision): Promise<string> {
  const run = await kernel.store.readRun(decision.runId);
  const waiting = run === undefined ? undefined : storedWaiting(kernel, run);
  if (waiting?.reason !== "approval" || waiting.stepKey !== decision.stepKey) {
    return `step ${decision.stepKey} of run ${decision.runId}`;
  }
  return `${waiting.question}\n${JSON.stringify(waiting.content, null, 2)}\n(hash ${waiting.hash})`;
}

async function terminalRefusal(
  invocation: Invocation,
  kernel: Kernel,
  decision: Decision,
): Promise<string | undefined> {
  const terminal = invocation.context.terminal;
  if (!terminal.isInteractive()) {
    return (
      "bay approve needs an interactive terminal (stdin is not a TTY). Approvals are for the owner, not for agents: " +
      "run it yourself in a terminal, or, if the project config lists chat under approvals.from, use --via chat --quote."
    );
  }
  const verb = decision.decision === "approve" ? "Approve" : "Reject";
  const answer = await terminal.ask(`${verb} ${await shownText(kernel, decision)}\nType yes to confirm: `);
  return answer.trim().toLowerCase() === "yes" ? undefined : "Not confirmed; nothing changed.";
}

async function decide(request: ApprovalRequest): Promise<CommandResult> {
  const { invocation, kernel, channel, decision } = request;
  const allowed = allowedChannels(kernel);
  if (!allowed.includes(channel.via)) {
    return refusedResult(
      `Approvals from ${channel.via} are off: approvals.from in agentbay.config.yaml lists ${allowed.join(", ")}.`,
      `Approve from ${allowed.join(" or ")}; only the owner changes approvals.from.`,
    );
  }
  const refusal = channel.via === "terminal" ? await terminalRefusal(invocation, kernel, decision) : undefined;
  if (refusal !== undefined) {
    return refusedResult(refusal);
  }
  const by =
    channel.via === "terminal" ? "owner at the terminal" : `owner via chat, quoted: ${JSON.stringify(channel.quote)}`;
  const result = await kernel.engine.approve(decision.runId, decision.stepKey, {
    hash: decision.hash,
    decision: decision.decision,
    by,
  });
  return engineOutput(kernel, result, () => "issue");
}

function runApprove(invocation: Invocation): Promise<CommandResult> {
  const [runId = "", stepKey = ""] = invocation.positionals;
  const hash = invocation.values.get("hash");
  const channel = channelOf(invocation);
  if (hash === undefined) {
    return Promise.resolve(usageResult("approve needs --hash <the hash of what the approval shows>.", usage));
  }
  if (typeof channel === "string") {
    return Promise.resolve(usageResult(channel, usage));
  }
  const decision: Decision = { runId, stepKey, hash, decision: invocation.flags.has("reject") ? "reject" : "approve" };
  return withKernel(invocation, (kernel) => decide({ invocation, kernel, channel, decision }));
}

export const approveCommand: Command = {
  name: "approve",
  summary:
    "Approve or reject what a waiting approval shows, naming its hash; from a terminal, or from chat if allowed.",
  usage,
  options: [
    { name: "hash", takesValue: true },
    { name: "reject", takesValue: false },
    { name: "via", takesValue: true },
    { name: "quote", takesValue: true },
  ],
  positionals: { least: 2, most: 2 },
  handler: runApprove,
};
