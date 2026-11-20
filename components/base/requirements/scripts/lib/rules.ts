import {
  conditionsOf,
  type Change,
  type Condition,
  type Listed,
  type Outcome,
  type Path,
  type Requirements,
  type Text,
} from "./requirements.ts";
import { movingDateWords, vagueWords } from "./words.ts";

export type Rule =
  | "file not read"
  | "not YAML"
  | "not the form"
  | "job is not the file's name"
  | "no literal in then"
  | "no literal in after"
  | "vague word"
  | "date that moves"
  | "no refusal"
  | "id used twice"
  | "id not its outcome's"
  | "removed id used again"
  | "changes do not match the version"
  | "recommended is not an answer";

export type Found = {
  readonly rule: Rule;
  readonly at: Path;
  readonly sentence: string;
};

type Named = {
  readonly id: string;
  readonly at: Path;
  readonly what: string;
};

const literal = /"[^"]*"|\d/;

const quotedValue = /"[^"]*"/g;

const changeLists = ["added", "changed", "removed"] as const;

function listed(texts: readonly string[]): string {
  const last = texts.at(-1) ?? "";
  return texts.length < 2 ? last : `${texts.slice(0, -1).join(", ")} and ${last}`;
}

function quoted(words: readonly string[]): string {
  return listed(words.map((word) => `"${word}"`));
}

function wordPattern(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
}

function ownWording(text: string): string {
  return text.replace(quotedValue, " ");
}

function wordsIn(text: string, words: readonly string[]): readonly string[] {
  return words.filter((word) => wordPattern(word).test(text));
}

function labelOf(condition: Condition): string {
  return condition.id ?? "A condition";
}

function checkedTexts(condition: Condition): readonly Text[] {
  return condition.texts.filter((text) => text.field !== "after" || condition.refused);
}

function literalProblems(condition: Condition): readonly Found[] {
  const missing = checkedTexts(condition).filter(
    (text) => (text.field === "then" || text.field === "after") && !literal.test(text.text),
  );
  return missing.map((text) => ({
    rule: text.field === "then" ? "no literal in then" : "no literal in after",
    at: [...condition.at, text.field],
    sentence:
      `${labelOf(condition)}'s ${text.field} holds no literal value. Write the value a person sees, ` +
      "in double quotes or as a number, such as 0 todos are listed in place of the list is empty.",
  }));
}

function missingAfterProblems(condition: Condition): readonly Found[] {
  if (!condition.refused || condition.texts.some((text) => text.field === "after")) {
    return [];
  }
  const sentence =
    `${labelOf(condition)} is refused but has no after. Add after: what a person sees once the refusal is over, ` +
    'with its value, such as the open list shows only "buy milk".';
  return [{ rule: "no literal in after", at: condition.at, sentence }];
}

function wordProblems(condition: Condition): readonly Found[] {
  return checkedTexts(condition).flatMap((text): readonly Found[] => {
    const at = [...condition.at, text.field];
    const label = `${labelOf(condition)}'s ${text.field}`;
    const wording = ownWording(text.text);
    const vague = wordsIn(wording, vagueWords);
    const moving = wordsIn(wording, movingDateWords);
    const vagueFound: readonly Found[] =
      vague.length === 0
        ? []
        : [
            {
              rule: "vague word",
              at,
              sentence:
                `${label} holds ${quoted(vague)} outside a quoted value, which a person cannot check. ` +
                "Say what a person sees, with its value; a word inside double quotes is a value and may stay.",
            },
          ];
    const movingFound: readonly Found[] =
      moving.length === 0
        ? []
        : [
            {
              rule: "date that moves",
              at,
              sentence:
                `${label} says ${quoted(moving)} outside a quoted value, a date that moves. ` +
                "Give the date itself, such as the date is 2026-11-21.",
            },
          ];
    return [...vagueFound, ...movingFound];
  });
}

function refusalProblems(outcome: Outcome): readonly Found[] {
  const refuses = outcome.noRefusal || outcome.conditions.some((condition) => condition.refused);
  if (refuses || outcome.conditions.length === 0) {
    return [];
  }
  const sentence =
    `${outcome.id ?? "An outcome"} has no refused condition. Add one that says what is refused and what a person ` +
    "sees after, or say in noRefusal why no input of it can be refused.";
  return [{ rule: "no refusal", at: [...outcome.at, "id"], sentence }];
}

function ownIdProblems(outcome: Outcome): readonly Found[] {
  const outcomeId = outcome.id;
  if (outcomeId === undefined) {
    return [];
  }
  const strangers = outcome.conditions.filter(
    (condition) => condition.id !== undefined && !condition.id.startsWith(`${outcomeId}-C`),
  );
  return strangers.map((condition) => ({
    rule: "id not its outcome's",
    at: [...condition.at, "id"],
    sentence:
      `${labelOf(condition)} is a condition of ${outcomeId}, so its id starts with ${outcomeId}-C. ` +
      "Renumber it, or move it under the outcome its id names.",
  }));
}

function namedOf(requirements: Requirements): readonly Named[] {
  const outcomes = requirements.outcomes.flatMap((outcome, index): readonly Named[] => {
    const own =
      outcome.id === undefined ? [] : [{ id: outcome.id, at: outcome.at, what: `outcome ${String(index + 1)}` }];
    const conditions = outcome.conditions.flatMap((condition, place) =>
      condition.id === undefined
        ? []
        : [
            {
              id: condition.id,
              at: condition.at,
              what: `condition ${String(place + 1)} of outcome ${String(index + 1)}`,
            },
          ],
    );
    return [...own, ...conditions];
  });
  const questions = requirements.open.flatMap((question, index) =>
    question.id === undefined ? [] : [{ id: question.id, at: question.at, what: `open question ${String(index + 1)}` }],
  );
  return [...outcomes, ...questions];
}

function twiceProblems(requirements: Requirements): readonly Found[] {
  const named = namedOf(requirements);
  return named.flatMap((entry, index): readonly Found[] => {
    const first = named.find((other) => other.id === entry.id);
    if (first === undefined || named.indexOf(first) === index) {
      return [];
    }
    const sentence =
      `The id ${entry.id} is given twice: to ${first.what} and to ${entry.what}. ` +
      "Give each its own id, since forge and the tests name each by it.";
    return [{ rule: "id used twice", at: [...entry.at, "id"], sentence }];
  });
}

function removedAgainProblems(requirements: Requirements): readonly Found[] {
  const conditions = conditionsOf(requirements);
  return requirements.changes.flatMap((change) =>
    change.removed.flatMap((removed): readonly Found[] => {
      const version = String(change.version ?? "?");
      const kept = conditions.filter((condition) => condition.id === removed.id);
      const readded = requirements.changes.filter(
        (later) => (later.version ?? 0) > (change.version ?? 0) && later.added.some((added) => added.id === removed.id),
      );
      const inConditions = kept.map((condition) => ({
        rule: "removed id used again" as const,
        at: [...condition.at, "id"],
        sentence: `${removed.id} was removed in version ${version}, and a removed id is never used again. Give this condition a new id.`,
      }));
      const inChanges = readded.flatMap((later) =>
        later.added
          .filter((added) => added.id === removed.id)
          .map((added) => ({
            rule: "removed id used again" as const,
            at: added.at,
            sentence:
              `${removed.id} was removed in version ${version} and is added again in version ${String(later.version)}. ` +
              "A removed id is never used again: add the condition with a new id.",
          })),
      );
      return [...inConditions, ...inChanges];
    }),
  );
}

function entryCountProblems(changes: readonly Change[], version: number): readonly Found[] {
  const versions = Array.from({ length: version }, (_, index) => index + 1);
  const missing = versions.filter((each) => !changes.some((change) => change.version === each));
  const missingFound: readonly Found[] =
    missing.length === 0
      ? []
      : [
          {
            rule: "changes do not match the version",
            at: ["changes"],
            sentence:
              `The file is version ${String(version)}, and changes has no entry for version ${listed(missing.map(String))}. ` +
              "Add one entry per version, with the condition ids it added, changed and removed.",
          },
        ];
  const extra = changes.filter(
    (change, index) =>
      change.version !== undefined &&
      (change.version > version || changes.findIndex((other) => other.version === change.version) !== index),
  );
  const extraFound = extra.map((change) => ({
    rule: "changes do not match the version" as const,
    at: [...change.at, "version"],
    sentence:
      `changes has an entry for version ${String(change.version)} that the file cannot have: it is version ` +
      `${String(version)}, and each version has one entry. Remove this entry, or correct its version.`,
  }));
  return [...missingFound, ...extraFound];
}

function unknownIdProblems(change: Change, ids: ReadonlySet<string>, version: number): readonly Found[] {
  const unknown = (entries: readonly Listed[], key: string): readonly Found[] => {
    const strangers = entries.filter((entry) => !ids.has(entry.id));
    const first = strangers[0];
    if (first === undefined) {
      return [];
    }
    const sentence =
      `Version ${String(version)} lists ${listed(strangers.map((entry) => entry.id))} as ${key}, ` +
      `but no condition of the file has ${strangers.length === 1 ? "that id" : "those ids"}. ` +
      `Remove ${strangers.length === 1 ? "it" : "them"} from ${key}, or add ${strangers.length === 1 ? "the condition" : "the conditions"}.`;
    return [{ rule: "changes do not match the version", at: first.at, sentence }];
  };
  return [...unknown(change.added, "added"), ...unknown(change.changed, "changed")];
}

function firstVersionProblems(change: Change, ids: readonly string[]): readonly Found[] {
  const added = new Set(change.added.map((entry) => entry.id));
  const left = [...new Set(ids)].filter((id) => !added.has(id));
  const leftFound: readonly Found[] =
    left.length === 0
      ? []
      : [
          {
            rule: "changes do not match the version",
            at: [...change.at, "added"],
            sentence: `Version 1 adds every condition, but its added leaves out ${listed(left)}. Add them to added.`,
          },
        ];
  const notEmpty = changeLists.filter((key) => key !== "added" && change[key].length > 0);
  const notEmptyFound = notEmpty.map((key) => ({
    rule: "changes do not match the version" as const,
    at: [...change.at, key],
    sentence: `Version 1 is the first, so it ${key} nothing. Make its ${key} empty.`,
  }));
  return [...leftFound, ...notEmptyFound];
}

function changesProblems(requirements: Requirements): readonly Found[] {
  const version = requirements.version;
  if (version === undefined) {
    return [];
  }
  const ids = conditionsOf(requirements).flatMap((condition) => (condition.id === undefined ? [] : [condition.id]));
  const current = requirements.changes.find((change) => change.version === version);
  const currentFound =
    current === undefined
      ? []
      : [
          ...unknownIdProblems(current, new Set(ids), version),
          ...(version === 1 ? firstVersionProblems(current, ids) : []),
        ];
  return [...entryCountProblems(requirements.changes, version), ...currentFound];
}

function recommendedProblems(requirements: Requirements): readonly Found[] {
  const astray = requirements.open.filter(
    (question) =>
      question.recommended !== undefined && question.answers >= 2 && question.recommended >= question.answers,
  );
  return astray.map((question) => ({
    rule: "recommended is not an answer",
    at: [...question.at, "recommended"],
    sentence:
      `${question.id ?? "A question"} recommends answer ${String(question.recommended)}, but it has ` +
      `${String(question.answers)} answers, counted from 0. Recommend one of 0 to ${String(question.answers - 1)}.`,
  }));
}

function jobProblems(file: string, requirements: Requirements): readonly Found[] {
  const name = (file.split("/").at(-1) ?? "").replace(/\.yaml$/, "");
  const job = requirements.job;
  if (job === undefined || job === name) {
    return [];
  }
  const sentence = `The job is ${job}, but the file is ${name}.yaml. Name the job ${name}, or the file ${job}.yaml.`;
  return [{ rule: "job is not the file's name", at: ["job"], sentence }];
}

export function brokenRules(file: string, requirements: Requirements): readonly Found[] {
  const conditions = conditionsOf(requirements);
  return [
    ...jobProblems(file, requirements),
    ...conditions.flatMap(literalProblems),
    ...conditions.flatMap(missingAfterProblems),
    ...conditions.flatMap(wordProblems),
    ...requirements.outcomes.flatMap(refusalProblems),
    ...requirements.outcomes.flatMap(ownIdProblems),
    ...twiceProblems(requirements),
    ...removedAgainProblems(requirements),
    ...changesProblems(requirements),
    ...recommendedProblems(requirements),
  ];
}
