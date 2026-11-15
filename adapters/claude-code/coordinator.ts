import { join } from "node:path";
import type { Layout } from "../../bay/adapter.ts";

export const blockStart = "<!-- agentbay:start -->";

export const blockEnd = "<!-- agentbay:end -->";

export type BlockAddition = {
  readonly kind: "claude-md";
  readonly separator: string;
};

function shellWord(text: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(text) ? text : `'${text}'`;
}

export function bayCommand(layout: Layout): string {
  if (layout.kit === layout.project) {
    return "./bay.sh";
  }
  return `${shellWord(join(layout.kit, "bay.sh"))} --project ${shellWord(layout.project)}`;
}

export function coordinatorBlock(bay: string): string {
  return [
    blockStart,
    "## agentbay: how the coordinator works",
    "",
    "The agentbay build writes this block; change the modes, not this block.",
    "",
    "You are the owner's coordinator. Run agentbay actions through its command line and give each skill step",
    "to the agent made for it.",
    "",
    `At the start of a session, run \`${bay} check\`. If it reports that the agentbay hook is not registered,`,
    "stop and tell the owner: without the hook, nothing confines the skill steps.",
    "",
    `1. Run an action: \`${bay} call <mode.action> '<json input>' --json\`. It prints one JSON object: the run.`,
    "2. When the run waits for a skill, the output carries a `task`. Start the subagent named `task.agent` with",
    "   the Agent tool, and give it the task JSON, exactly as printed, as its whole prompt and nothing else.",
    `3. When the subagent returns, run \`${bay} runs <runId> --json\` and continue from what it shows: another`,
    "   `task` (step 2 again), an approval (step 4), done (report the output) or failed (report the reason).",
    "4. An approval is the owner's decision, never yours. Show the owner the content to approve and its hash,",
    "   then wait. Only after the owner answers, run",
    `   \`${bay} approve <runId> --hash <hash> --via chat --quote "<the owner's exact words>" --json\`.`,
    "",
    "Never:",
    "- approve on your own, or quote words the owner did not write;",
    "- edit `.agentbay/`, `.claude/`, `.mcp.json`, or the agentbay kit (`bay/`, `schemas/`, `adapters/`,",
    "  `framework/`);",
    "- do a skill step's work yourself, change a task before you hand it over, or hand it to another agent;",
    "- start other subagents here: the agentbay hook denies every tool call of a subagent that is not a step.",
    "",
    "Change `approvals` in agentbay.config.yaml only when the owner asks for exactly that, in their own words.",
    blockEnd,
  ].join("\n");
}

export function insertBlock(text: string | undefined, block: string): { text: string; addition: BlockAddition } {
  if (text === undefined || text === "") {
    return { text: `${block}\n`, addition: { kind: "claude-md", separator: "" } };
  }
  const separator = text.endsWith("\n") ? "\n" : "\n\n";
  return { text: `${text}${separator}${block}\n`, addition: { kind: "claude-md", separator } };
}

function blockAround(text: string): { readonly before: string; readonly after: string } | undefined {
  const start = text.indexOf(blockStart);
  const end = start === -1 ? -1 : text.indexOf(blockEnd, start);
  if (end === -1) {
    return undefined;
  }
  const afterEnd = end + blockEnd.length;
  return { before: text.slice(0, start), after: text.slice(text[afterEnd] === "\n" ? afterEnd + 1 : afterEnd) };
}

export function replaceBlock(text: string, block: string): string | undefined {
  const around = blockAround(text);
  return around === undefined ? undefined : `${around.before}${block}\n${around.after}`;
}

export function removeBlock(text: string, addition: BlockAddition): string | undefined {
  const around = blockAround(text);
  if (around === undefined) {
    return undefined;
  }
  const { before, after } = around;
  const trimmed = before.endsWith(addition.separator);
  return trimmed ? before.slice(0, before.length - addition.separator.length) + after : before + after;
}
