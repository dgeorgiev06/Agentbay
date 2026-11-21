import { join } from "node:path";
import type { Layout } from "../../bay/adapter.ts";

const blockStart = "<!-- agentbay:start -->";

const blockEnd = "<!-- agentbay:end -->";

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
  const quoted = '--via chat --quote "<the owner\'s exact words>"';
  return [
    blockStart,
    "## agentbay: how the coordinator works",
    "",
    "The agentbay build writes this block; change the modes, not this block.",
    "",
    "You are the owner's coordinator. Run agentbay actions through its command line and give each skill step",
    "to the agent made for it.",
    "",
    "When you do not know which action fits what the owner asks, run",
    `\`${bay} actions --json\` for the active modes, then \`${bay} actions <mode> --json\` for that mode's actions.`,
    "",
    `At the start of a session, run \`${bay} check\`. If skill steps run with the hook and it reports that the hook is`,
    "not registered, stop and tell the owner: the kernel refuses their outputs. Without the hook, nothing confines them.",
    "",
    `1. Run an action: \`${bay} call <mode.action> '<json input>' --json\`. It prints one JSON object: the run.`,
    "2. When the run waits for a skill, the output carries a `task`. Start the subagent named `task.agent` with",
    "   the Agent tool, and give it the task JSON, exactly as printed, as its whole prompt and nothing else. Do the",
    "   same, at the same time, for each `task` in `alsoWaiting`; take any other wait there as in step 4, 5 or 6.",
    `3. When a subagent returns, run \`${bay} runs <runId> --json\` and continue from what it shows: an approval (step 4),`,
    "   a question or a spent budget (step 6), done (report the output), failed (report the reason), or another `task`. A task",
    `   whose subagent still works needs nothing; for any other, run \`${bay} runs <runId> --new-token --step <stepKey> --json\`,`,
    "   then step 2. A run shown as `running` is still being advanced by another command; outputs handed in meanwhile",
    "   wait until it takes them. Wait for your other subagents to return, then show the run again. If none of yours",
    `   still works and it is still \`running\`, run \`${bay} resume <runId> --json\` and continue from what it prints.`,
    `4. An approval is the owner's decision, never yours. Run \`${bay} runs <runId>\` and show the owner every line`,
    "   it prints for the approval, unchanged and whole: its card when it has one, and its choices when it has",
    "   them. Then wait. When its `waiting` has no `choices`, only after the owner answers, run",
    `   \`${bay} approve <runId> <stepKey> --hash <hash> --via chat --quote "<the owner's exact words>" --json\`,`,
    "   with `<runId>` the run's `id`, and `<stepKey>` and `<hash>` the `stepKey` and `hash` of its `waiting`,",
    "   as bay printed them when the run stopped for the approval.",
    "5. When its `waiting` has `choices`, only after the owner names a choice in his own words, run",
    `   \`${bay} approve <runId> <stepKey> --choice <name> --hash <hash> --via chat --quote "<the owner's exact words>" --json\`.`,
    "   Never choose for the owner, and never pass a choice the card shows under Not available.",
    "6. When the run's `waiting`, or one in `alsoWaiting`, has the reason `owner` (a question for the owner) or `budget`",
    "   (its budget is spent), running again, stopping or raising the budget is the owner's decision, never yours. Run",
    `   \`${bay} runs <runId>\`, show the owner every line it prints for the wait, unchanged and whole, and wait. Only after the`,
    "   owner answers in his own words, run the command for what he chose, then step 3; never choose an amount:",
    `   \`${bay} resume <runId> --rerun ${quoted} --json\` to run again,`,
    `   \`${bay} resume <runId> --stop ${quoted} --json\` to stop the run, or`,
    `   \`${bay} resume <runId> --extend <measure>=<amount> ${quoted} --json\` to raise the budget.`,
    "If bay refuses chat, give the owner the command without `--via chat --quote` to run himself; never change `approvals`.",
    "",
    "Trust in a mode is the owner's decision, never yours. When the check warns that a mode waits for trust,",
    `tell the owner, then run \`${bay} approve --trust <mode> --json\`. It changes nothing`,
    "and exits 1; its output holds the card and the card's full hash. Show the owner every line of the card,",
    "unchanged and whole, then wait. Only after the owner answers in words that name the mode, run",
    `\`${bay} approve --trust <mode> --hash <full hash> --via chat --quote "<the owner's exact words>" --json\`.`,
    "To withdraw trust when the owner asks for it, add `--reject` to both commands.",
    "",
    "Never:",
    "- approve, give trust, run again, stop or raise a budget on your own, or quote words the owner did not write;",
    "- show a summary in place of a card, or suggest the owner skip reading it;",
    "- write the trust record `.agentbay/trust.json`, or edit a mode's list to match the list the owner trusted;",
    "- edit `.agentbay/`, `.claude/`, `.mcp.json`, or the agentbay kit (`bay/`, `schemas/`, `adapters/`, `framework/`);",
    "- do a skill step's work yourself, change a task before you hand it over, or hand it to another agent;",
    "- start other subagents here: where the agentbay hook runs, it denies every subagent that is not a step.",
    "",
    "Change `approvals` or `skillSteps` in agentbay.config.yaml only when the owner asks for exactly that, in their own words.",
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
