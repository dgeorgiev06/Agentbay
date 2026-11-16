import { failedWith, succeededWith, unplacedProblem, type Outcome, type Problem } from "../outcome.ts";
import type { ActiveMode, System, ModeListed, ActionListed, ActionsListing, ListingQuestion } from "./manifests.ts";

function wordsOf(find: string | undefined): readonly string[] {
  return (find ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
}

function holdsEveryWord(words: readonly string[], entry: ModeListed | ActionListed): boolean {
  const text = `${entry.name} ${entry.description}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

function activeModesByName(system: System): readonly ActiveMode[] {
  return [...system.modes.keys()].sort().flatMap((name) => system.modes.get(name) ?? []);
}

function listedModes(system: System, words: readonly string[]): ActionsListing {
  const modes = activeModesByName(system).map((mode) => ({
    name: mode.manifest.name,
    description: mode.manifest.description,
  }));
  return { modes: modes.filter((mode) => holdsEveryWord(words, mode)) };
}

function listedActions(mode: ActiveMode, words: readonly string[]): Outcome<ActionsListing> {
  const actions: ActionListed[] = [];
  const problems: Problem[] = [];
  for (const [name, action] of Object.entries(mode.manifest.actions)) {
    const reference = `${mode.manifest.name}.${name}`;
    const input = mode.actionSchemas.get(name)?.input.json;
    if (input === undefined) {
      problems.push(unplacedProblem(`The input schema of ${reference} could not be read.`, "Run bay check."));
      continue;
    }
    actions.push({ name: reference, description: action.description, effects: action.effects, input });
  }
  if (problems.length > 0) {
    return failedWith(problems);
  }
  return succeededWith({ mode: mode.manifest.name, actions: actions.filter((entry) => holdsEveryWord(words, entry)) });
}

export function actionsListing(system: System, question: ListingQuestion): Outcome<ActionsListing> {
  const words = wordsOf(question.find);
  if (question.mode === undefined) {
    return succeededWith(listedModes(system, words));
  }
  const mode = system.modes.get(question.mode);
  if (mode === undefined) {
    const active = activeModesByName(system).map((entry) => entry.manifest.name);
    return failedWith([
      unplacedProblem(
        `There is no active mode ${question.mode}. The active modes are ${active.join(", ")}.`,
        "Name one of them, or leave the mode out to list them.",
      ),
    ]);
  }
  return listedActions(mode, words);
}
