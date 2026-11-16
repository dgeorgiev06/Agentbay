import { problemsResult, succeeded, type CommandResult, type Invocation } from "../command-context.ts";
import type { Command } from "../command-line.ts";
import {
  actionsListing,
  loadSystemReport,
  type ActionListed,
  type ActionsListing,
  type ListingQuestion,
  type ModeListed,
} from "../manifests/registry.ts";

const modeHint = "bay actions <mode> lists the actions of one mode.";

function modesText(modes: readonly ModeListed[], find: string | undefined): string {
  if (modes.length === 0) {
    return find === undefined ? "No mode is active in this project." : `No active mode holds every word of: ${find}.`;
  }
  const width = Math.max(...modes.map((mode) => mode.name.length));
  const lines = modes.map((mode) => `${mode.name.padEnd(width)}  ${mode.description}`);
  return [...lines, modeHint].join("\n");
}

function actionLines(action: ActionListed): readonly string[] {
  const effects = action.effects.length === 0 ? "none" : action.effects.join(", ");
  return [action.name, `  ${action.description}`, `  effects: ${effects}`, `  input: ${JSON.stringify(action.input)}`];
}

function actionsText(mode: string, actions: readonly ActionListed[], find: string | undefined): string {
  if (actions.length === 0) {
    return find === undefined
      ? `Mode ${mode} has no actions.`
      : `No action of mode ${mode} holds every word of: ${find}.`;
  }
  return actions.flatMap(actionLines).join("\n");
}

function listingText(listing: ActionsListing, find: string | undefined): string {
  return "modes" in listing ? modesText(listing.modes, find) : actionsText(listing.mode, listing.actions, find);
}

function questionOf(invocation: Invocation): ListingQuestion {
  const [mode] = invocation.positionals;
  const find = invocation.values.get("find");
  return { ...(mode === undefined ? {} : { mode }), ...(find === undefined ? {} : { find }) };
}

async function runActions(invocation: Invocation): Promise<CommandResult> {
  const report = await loadSystemReport(invocation.context.ports.files, invocation.layout);
  if (!report.outcome.ok) {
    return problemsResult(report.outcome.problems);
  }
  const question = questionOf(invocation);
  const listing = actionsListing(report.outcome.value, question);
  if (!listing.ok) {
    return problemsResult(listing.problems);
  }
  return succeeded({ ...listing.value }, listingText(listing.value, question.find));
}

export const actionsCommand: Command = {
  name: "actions",
  summary:
    "List the active modes, or the actions of one mode with their descriptions, effects and input schemas; " +
    "--find keeps those that hold every given word.",
  usage: "actions [<mode>] [--find <words>]",
  options: [{ name: "find", takesValue: true }],
  positionals: { least: 0, most: 1 },
  handler: runActions,
};
