import { canonicalJson, defineScript, fail, type Json } from "../../../../bay/sdk.ts";
import { fieldsOf, listOf, numberOf, textOf, textsOf, type Fields } from "./lib/json.ts";
import { wordCount } from "./lib/words.ts";

const copiedWords = 12;

type Given = {
  readonly selection: Fields;
  readonly ids: ReadonlySet<string>;
  readonly excerpts: readonly (readonly [string, string])[];
  readonly limits: Fields;
};

function givenOf(selection: Fields): Given {
  const items = listOf(selection.items).map(fieldsOf);
  const excerpts = items.map((item) => [textOf(item.id) ?? "", textOf(item.excerpt) ?? ""] as const);
  return {
    selection,
    ids: new Set(excerpts.map(([id]) => id)),
    excerpts: excerpts.filter(([, excerpt]) => wordCount(excerpt) >= copiedWords),
    limits: fieldsOf(selection.limits),
  };
}

function wordProblem(label: string, text: string, most: number): readonly string[] {
  const words = wordCount(text);
  return words > most ? [`${label} has ${String(words)} words; use at most ${String(most)}.`] : [];
}

function citationProblems(given: Given, theme: Fields, label: string): readonly string[] {
  const cites = textsOf(theme.cites);
  if (cites.length === 0) {
    return [`${label} cites no item; every theme rests on at least one item id from the input.`];
  }
  return cites
    .filter((id) => !given.ids.has(id))
    .map((id) => `${label} cites ${id}, which is not one of the items you were given; cite only ids from the input.`);
}

function copyProblems(given: Given, summary: string, label: string): readonly string[] {
  const lowered = summary.toLowerCase();
  return given.excerpts
    .filter(([, excerpt]) => lowered.includes(excerpt.replace(/…$/, "").toLowerCase()))
    .map(([id]) => `${label} copies the text of ${id}; say what it says in your own words.`);
}

function themeProblems(given: Given, value: Json, index: number): readonly string[] {
  const theme = fieldsOf(value);
  const title = textOf(theme.title) ?? "";
  const summary = textOf(theme.summary) ?? "";
  const label = `Theme ${String(index + 1)} ("${title}")`;
  return [
    ...citationProblems(given, theme, label),
    ...wordProblem(`The title of ${label}`, title, numberOf(given.limits.titleWords)),
    ...wordProblem(`The summary of ${label}`, summary, numberOf(given.limits.summaryWords)),
    ...copyProblems(given, summary, label),
  ];
}

function copiedFieldProblems(given: Given, draft: Fields): readonly string[] {
  const problems: string[] = [];
  if (canonicalJson(draft.period ?? null) !== canonicalJson(given.selection.period ?? null)) {
    problems.push(`Copy period exactly from the input: ${canonicalJson(given.selection.period ?? null)}.`);
  }
  if (draft.selectorChanged !== given.selection.selectorChanged) {
    problems.push(
      `Copy selectorChanged exactly from the input: ${canonicalJson(given.selection.selectorChanged ?? null)}.`,
    );
  }
  return problems;
}

function draftProblems(given: Given, draft: Fields): readonly string[] {
  const themes = listOf(draft.themes);
  const most = numberOf(given.limits.themes);
  return [
    ...copiedFieldProblems(given, draft),
    ...(themes.length > most ? [`The digest has ${String(themes.length)} themes; write at most ${String(most)}.`] : []),
    ...themes.flatMap((theme, index) => themeProblems(given, theme, index)),
    ...wordProblem("The notes", textOf(draft.notes) ?? "", numberOf(given.limits.notesWords)),
  ];
}

export const run = defineScript((input, context) => {
  if (context.skillInput === undefined) {
    return fail("check-citations runs only as a check of the digest skill, which gives it the skill's input.");
  }
  const problems = draftProblems(givenOf(fieldsOf(context.skillInput)), fieldsOf(input));
  return Promise.resolve(problems.length === 0 ? { passed: true } : { passed: false, feedback: problems.join(" ") });
});
