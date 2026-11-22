import type { Chosen, Finding } from "./challenge-answer.ts";
import {
  computed,
  counted,
  facts,
  joined,
  judged,
  safeText,
  shortened,
  shortFacts,
  type CardLine,
  type Fact,
  type Screen,
} from "./card-lines.ts";
import { stayedLines, type Stayed } from "./branch-endings.ts";
import {
  actionsOf,
  type Action,
  type Design,
  type DesignerAnswer,
  type Interface,
  type Module,
  type Rule,
  type Value,
} from "./design-form.ts";
import { examplesSpelled } from "./design-examples.ts";
import { heldByRules } from "./design-rules.ts";
import type { DesignPath } from "./path-card.ts";
import { tallyOf, withheldAfterAnswer, type FirstFound, type PracticeAnswer } from "./practice-answers.ts";
import type { Practice } from "./practices.ts";
import { conditionsOf, type Requirements } from "./requirements-form.ts";

export type DesignCardInput = {
  readonly file: string;
  readonly requirements: Requirements;
  readonly path: DesignPath;
  readonly chosen: Chosen;
  readonly because: string;
  readonly design: Design;
  readonly problems: readonly string[];
  readonly checks: number;
  readonly refusedSchemas: number;
  readonly asked: readonly Practice[];
  readonly practices: readonly PracticeAnswer[];
  readonly findings: readonly Finding[];
  readonly said: readonly DesignerAnswer[];
  readonly differences: readonly string[];
  readonly second?: SecondPass;
  readonly stayed?: readonly Stayed[];
};

export type SecondPass = FirstFound & {
  readonly changes: readonly string[];
};

export type DesignCard = {
  readonly card: Screen & { readonly withheld: { readonly approve?: string } };
  readonly offered: { readonly approve: boolean };
};

const designers = "designs";

const challenger = "challenge";

const answeringDesigner = "design-again";

const secondChallenger = "challenge-again";

const storeShownLength = 80;

const practiceShownLength = 80;

const storePattern = /^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/;

const answers: Readonly<Record<Chosen, string>> = {
  first: "the first of two designs written apart",
  second: "the second of two designs written apart",
  merged: "a design the review step merged from two written apart",
};

const answerWords: Readonly<Record<PracticeAnswer["answer"], string>> = {
  held: "held",
  "not-held": "not held",
  "does-not-apply": "does not apply",
};

function whichWords(input: DesignCardInput): string {
  const which = input.path === "light" ? "the one design written, on the light path" : answers[input.chosen];
  const answered = input.second === undefined ? "" : ", answered once by its designer after the first review";
  return `This is ${which}${answered}.`;
}

function withheldReason(input: DesignCardInput): string | undefined {
  const reasons = [
    ...(input.problems.length === 0 ? [] : [`The design check found ${counted(input.problems.length, "problem")}.`]),
    ...withheldAfterAnswer(input.practices, "design", input.second !== undefined),
  ];
  return reasons.length === 0 ? undefined : reasons.join(" ");
}

function designerStep(input: DesignCardInput): string {
  if (input.second !== undefined) {
    return answeringDesigner;
  }
  return input.chosen === "merged" ? challenger : designers;
}

function challengerStep(input: DesignCardInput): string {
  return input.second === undefined ? challenger : secondChallenger;
}

function practiceWords(input: DesignCardInput, id: string): string {
  const says = input.asked.find((practice) => practice.id === id)?.says ?? "";
  const [first = ""] = says.split(/(?<=\.)\s/);
  const sentence = shortened(first.replace(/\.$/, ""), practiceShownLength);
  return sentence === "" ? id : `${sentence} (${id})`;
}

function ownsWords(module: Module): string {
  const tables = module.tables.map((table) => `the table ${table}`);
  const files = module.files.map((file) => `the file ${file}`);
  const owned = [...tables, ...files];
  return owned.length === 0 ? "owns nothing" : `owns ${joined(owned)}`;
}

function storeShown(store: string): string {
  return storePattern.test(store) ? shortened(store, storeShownLength) : `"${shortened(store, storeShownLength)}"`;
}

function valueWords(values: readonly Value[], into: string): string {
  const named = values.map((value) =>
    value.store === undefined ? value.name : `${value.name} (${into} ${storeShown(value.store)})`,
  );
  return named.length === 0 ? "nothing" : joined(named);
}

function ruleFacts(rule: Rule, module: Module, by: string): readonly Fact[] {
  const flows = `Takes ${valueWords(rule.takes, "from")}; gives ${valueWords(rule.gives, "into")}.`;
  return facts(
    "what",
    [computed("draw", flows), judged(by, `Decides: ${rule.decides}`)],
    `rule ${rule.name}, in module ${module.name}`,
  );
}

function moduleFacts(module: Module, by: string): readonly Fact[] {
  const offers = `It implements ${joined(module.implements)} and ${ownsWords(module)}.`;
  return [
    ...facts("what", [computed("draw", offers), judged(by, `Hides: ${module.hides}`)], `module ${module.name}`),
    ...module.rules.flatMap((rule) => ruleFacts(rule, module, by)),
  ];
}

function storesWords(verb: string, stores: readonly string[]): string {
  return `${verb} ${stores.length === 0 ? "nothing" : joined(stores.map(storeShown))}`;
}

function meetsWords(action: Action): string {
  if (action.serves.length === 0) {
    return "Meets none of your conditions.";
  }
  return `Meets ${counted(action.serves.length, "of your condition")} (${joined(action.serves)}).`;
}

function actionFacts(action: Action, by: string): readonly Fact[] {
  const rule = action.rule === undefined ? "Applies no rule" : `Applies the rule ${action.rule}`;
  const flows = `${rule}; ${storesWords("reads", action.reads)}; ${storesWords("writes", action.writes)}.`;
  const examples = `${counted(action.examples.length, "worked example")}.`;
  const why = action.serves.length > 0 ? [] : [judged(by, `Why it meets none: ${safeText(action.because ?? "")}`)];
  return facts(
    "what",
    [computed("draw", `${meetsWords(action)} ${flows} ${examples}`), ...why],
    `action ${action.name}`,
  );
}

function interfaceFacts(each: Interface, by: string): readonly Fact[] {
  const counts = `${counted(each.actions.length, "action")}, ${counted(each.actions.length * 2, "schema file")}.`;
  return [
    ...facts("what", [computed("draw", counts)], `interface ${each.name}`),
    ...each.actions.flatMap((action) => actionFacts(action, by)),
  ];
}

function coverageWords(input: DesignCardInput): string {
  const served = actionsOf(input.design).flatMap((action) => action.serves);
  const conditions = conditionsOf(input.requirements);
  const missed = conditions.filter((condition) => !served.includes(condition));
  const all = String(conditions.length);
  return missed.length === 0
    ? `Meets all ${all} of your conditions.`
    : `Leaves ${String(missed.length)} of your ${all} conditions unmet (${joined(missed)}).`;
}

function summaryWords(design: Design): string {
  const actions = actionsOf(design);
  const modules = counted(design.modules.length, "module");
  return `${modules}, ${counted(actions.length, "action")}: ${joined(actions.map((action) => action.name))}.`;
}

function examplesWords(input: DesignCardInput): string {
  const examples = actionsOf(input.design).flatMap((action) => action.examples);
  const refusals = examples.filter((example) => "refusal" in example.told).length;
  const notChecked = [
    ...(refusals === 0 ? [] : [`the input of the ${counted(refusals, "refusal")}`]),
    ...(input.refusedSchemas === 0
      ? []
      : [`against the ${counted(input.refusedSchemas, "schema")} the kernel refused`]),
  ];
  const counts = `${counted(examples.length, "worked example")} checked against their actions' schemas`;
  return notChecked.length === 0 ? `${counts}.` : `${counts}, but not ${joined(notChecked)}.`;
}

function spelledLines(input: DesignCardInput): readonly CardLine[] {
  const spelled = examplesSpelled(input.design);
  if (spelled === 0) {
    return [];
  }
  return [
    computed(
      "draw",
      `${counted(spelled, "worked example")} say a long text by rule; forge spelled them out before any check.`,
    ),
  ];
}

function checkWords(input: DesignCardInput): string {
  const found = input.problems.length === 0 ? "no problem" : counted(input.problems.length, "problem");
  return `${String(input.checks)} automatic checks: ${found} found.`;
}

function judgedWords(input: DesignCardInput): string {
  const tally = tallyOf(input.practices);
  const judgedCount = input.practices.length;
  if (judgedCount === 0) {
    return "it judged no practice";
  }
  if (tally.notHeld > 0) {
    const verb = tally.notHeld === 1 ? "is" : "are";
    return `${String(tally.notHeld)} of the ${counted(judgedCount, "practice")} it judged ${verb} not held`;
  }
  if (tally.doesNotApply === 0) {
    return `all ${counted(judgedCount, "practice")} it judged are held`;
  }
  const verb = tally.doesNotApply === 1 ? "does" : "do";
  const held = `${String(tally.held)} of the ${counted(judgedCount, "practice")} it judged are held`;
  return `${held}, and ${String(tally.doesNotApply)} ${verb} not apply`;
}

function reviewWords(input: DesignCardInput): string {
  return `A review by a model: ${counted(input.findings.length, "finding")}; ${judgedWords(input)}.`;
}

function differenceFacts(input: DesignCardInput): readonly Fact[] {
  if (input.path === "light") {
    return facts("what", [computed("draw", "One design was written, so none was compared.")]);
  }
  const about = "where the two designs differed";
  return facts(
    "what",
    [
      computed("draw", `${counted(input.differences.length, "difference")}, found by a script.`),
      ...input.differences.map((difference) => computed("draw", difference)),
      judged(challenger, `Why this design was chosen: ${input.because}`),
    ],
    about,
  );
}

function firstFoundWords(found: FirstFound): string {
  const notHeld = found.notHeld.length === 0 ? [] : [`answered ${joined(found.notHeld)} not held`];
  const findings = found.findings === 0 ? [] : [`gave ${counted(found.findings, "finding")}`];
  return `The first review ${joined([...notHeld, ...findings])}; the designer answered once.`;
}

function passFacts(input: DesignCardInput): readonly Fact[] {
  const { second } = input;
  if (second === undefined) {
    const once =
      "The designer was asked once; a second answer is asked only when the review step answers a practice not " +
      "held or gives a finding.";
    return facts("checks", [computed("draw", once)]);
  }
  return [
    ...facts("checks", [computed("draw", firstFoundWords(second))]),
    ...facts(
      "checks",
      [
        computed("draw", `${counted(second.changes.length, "change")}, found by a script.`),
        ...second.changes.map((change) => computed("draw", change)),
      ],
      "what the designer's answer changed",
    ),
    ...facts("checks", [computed("draw", "The second review's answers decide this approval.")]),
  ];
}

function scriptPracticeFacts(): readonly Fact[] {
  const lines = heldByRules.map((practice) => computed("draw", `${practice.says} (${practice.id}).`));
  return facts("checks", lines, "practices a script checks");
}

function answeredFacts(input: DesignCardInput): readonly Fact[] {
  const lines = input.practices.map((practice) =>
    computed("draw", `${practiceWords(input, practice.id)}: ${answerWords[practice.answer]}.`),
  );
  return facts("checks", lines, "practices the review step judged");
}

function findingFacts(input: DesignCardInput): readonly Fact[] {
  const count = input.findings.length === 0 ? "No findings." : `${counted(input.findings.length, "finding")}.`;
  const lines = [
    computed("draw", count),
    ...input.findings.map((finding) =>
      judged(challengerStep(input), `In ${finding.where}: ${finding.wrong} Fix: ${finding.fix}`),
    ),
  ];
  const about = input.second === undefined ? "findings of the review step" : "findings left after the answer";
  return facts("checks", lines, about);
}

function notHeldFacts(input: DesignCardInput, practice: PracticeAnswer): readonly Fact[] {
  const said = input.said.find((each) => each.id === practice.id);
  const lines = [
    computed("draw", `The review step answered not held: ${practiceWords(input, practice.id)}.`),
    judged(challengerStep(input), `Its reason: ${practice.sentence}`),
    ...(said === undefined ? [] : [judged(designerStep(input), `The designer answered: ${said.sentence}`)]),
  ];
  return facts("problems", lines, `practice ${practice.id}`);
}

function whatFacts(input: DesignCardInput): readonly Fact[] {
  const by = designerStep(input);
  const conditions = counted(conditionsOf(input.requirements).length, "condition");
  const outcomes = counted(input.requirements.outcomes.length, "outcome");
  return [
    ...shortFacts("what", [computed("draw", summaryWords(input.design)), computed("draw", coverageWords(input))]),
    ...facts("what", [
      computed("draw", whichWords(input)),
      computed("draw", `Your requirements: ${input.file}, ${outcomes}, ${conditions}.`),
    ]),
    ...input.design.modules.flatMap((module) => moduleFacts(module, by)),
    ...input.design.interfaces.flatMap((each) => interfaceFacts(each, by)),
    ...differenceFacts(input),
    ...facts("what", stayedLines(input.stayed ?? [])),
  ];
}

function checkFacts(input: DesignCardInput): readonly Fact[] {
  return [
    ...shortFacts("checks", [computed("draw", checkWords(input)), computed("draw", reviewWords(input))]),
    ...facts("checks", [computed("draw", examplesWords(input)), ...spelledLines(input)]),
    ...scriptPracticeFacts(),
    ...answeredFacts(input),
    ...passFacts(input),
    ...findingFacts(input),
  ];
}

function problemFacts(input: DesignCardInput): readonly Fact[] {
  const found = input.problems.map((problem) => computed("draw", `A check found: ${problem}`));
  const notHeld = input.practices.filter((practice) => practice.answer === "not-held");
  return [...facts("problems", found), ...notHeld.flatMap((practice) => notHeldFacts(input, practice))];
}

export function designCard(input: DesignCardInput): DesignCard {
  const reason = withheldReason(input);
  const lines = [...problemFacts(input), ...whatFacts(input), ...checkFacts(input)];
  const title = `Commit the design of ${input.requirements.job}?`;
  return {
    card: { title, lines, withheld: reason === undefined ? {} : { approve: reason } },
    offered: { approve: reason === undefined },
  };
}
