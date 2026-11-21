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
import {
  decidingWords,
  firstFoundWords,
  notHeldIds,
  notHeldLine,
  tallyOf,
  tallyWords,
  withheldAfterAnswer,
  type FirstFound,
  type PracticeAnswer,
} from "./practice-answers.ts";
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

const differencesShown = 8;

const storeShownLength = 80;

const storePattern = /^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/;

const answers: Readonly<Record<Chosen, string>> = {
  first: "the first design of two written apart",
  second: "the second design of two written apart",
  merged: "a design the challenger merged from two written apart",
};

function answerWords(input: DesignCardInput): string {
  const which = input.path === "light" ? "the one design, on the light path" : answers[input.chosen];
  return input.second === undefined ? which : `${which}, answered once after the first challenge`;
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
  return values
    .map((value) => (value.store === undefined ? value.name : `${value.name} ${into} ${storeShown(value.store)}`))
    .join(", ");
}

function ruleLines(rule: Rule, module: Module, by: string): readonly CardLine[] {
  const takes = valueWords(rule.takes, "from");
  const gives = valueWords(rule.gives, "into");
  return [
    computed("draw", `rule ${rule.name}, in ${module.name}: takes ${takes}; gives ${gives}`),
    judged(by, `${rule.name} decides: ${rule.decides}`),
  ];
}

function moduleLines(module: Module, by: string): readonly CardLine[] {
  return [
    computed("draw", `module ${module.name}: implements ${joined(module.implements)}; ${ownsWords(module)}`),
    judged(by, `${module.name} hides: ${module.hides}`),
    ...module.rules.flatMap((rule) => ruleLines(rule, module, by)),
  ];
}

function storesWords(verb: string, stores: readonly string[]): string {
  return `${verb} ${stores.length === 0 ? "nothing" : joined(stores.map(storeShown))}`;
}

function appliesWords(action: Action): string {
  const rule = action.rule === undefined ? "applies no rule" : `applies the rule ${action.rule}`;
  return `${rule}, ${storesWords("reads", action.reads)}, ${storesWords("writes", action.writes)}`;
}

function actionLines(action: Action, by: string): readonly CardLine[] {
  const examples = `${appliesWords(action)}; ${counted(action.examples.length, "example")}`;
  if (action.serves.length > 0) {
    return [computed("draw", `${action.name}: serves ${action.serves.join(", ")}; ${examples}`)];
  }
  return [
    computed("draw", `${action.name}: serves no condition; ${examples}`),
    judged(by, `${action.name}, why it serves none: ${safeText(action.because ?? "")}`),
  ];
}

function interfaceLines(each: Interface, by: string): readonly CardLine[] {
  const heading = `interface ${each.name}: ${counted(each.actions.length, "action")}, ${counted(
    each.actions.length * 2,
    "schema file",
  )}`;
  return [computed("draw", heading), ...each.actions.flatMap((action) => actionLines(action, by))];
}

function coverageWords(input: DesignCardInput): string {
  const served = actionsOf(input.design).flatMap((action) => action.serves);
  const conditions = conditionsOf(input.requirements);
  const missed = conditions.filter((condition) => !served.includes(condition));
  return missed.length === 0
    ? `Covers all ${String(conditions.length)} of your conditions.`
    : `Leaves ${String(missed.length)} of your ${String(conditions.length)} conditions unserved: ${joined(missed)}.`;
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
  const counts = `examples: ${String(examples.length)}`;
  if (notChecked.length === 0) {
    return `${counts}, each checked against its action's schemas`;
  }
  return `${counts}, checked against their actions' schemas, but not ${joined(notChecked)}`;
}

function spelledLines(input: DesignCardInput): readonly CardLine[] {
  const spelled = examplesSpelled(input.design);
  if (spelled === 0) {
    return [];
  }
  return [
    computed(
      "draw",
      `examples that say a long text by rule: ${String(spelled)}, spelled out by forge before any check`,
    ),
  ];
}

function checkWords(input: DesignCardInput): string {
  const found = input.problems.length === 0 ? "no problem" : counted(input.problems.length, "problem");
  return `${String(input.checks)} automatic checks: ${found} found.`;
}

function reviewWords(input: DesignCardInput): string {
  const notHeld = notHeldIds(input.practices);
  const findings = input.findings.length === 0 ? "no findings" : counted(input.findings.length, "finding");
  const practices =
    notHeld.length === 0
      ? "no practice not held"
      : `${counted(notHeld.length, "practice")} not held (${joined(notHeld)})`;
  return `A second model reviewed it and reported ${findings} and ${practices}.`;
}

function listedLines(heading: string, listed: readonly string[]): readonly CardLine[] {
  const shown = listed.slice(0, differencesShown);
  const more = listed.length - shown.length;
  return [
    computed("draw", `${heading}: ${String(listed.length)}`),
    ...shown.map((difference) => computed("draw", difference)),
    ...(more > 0 ? [computed("draw", `and ${String(more)} more`)] : []),
  ];
}

function differenceLines(input: DesignCardInput): readonly CardLine[] {
  if (input.path === "light") {
    return [computed("draw", "one design was written, so none was compared")];
  }
  return [
    ...listedLines("where the two designs differed", input.differences),
    judged(challenger, `chosen because: ${input.because}`),
  ];
}

function passLines(input: DesignCardInput): readonly CardLine[] {
  const { second } = input;
  if (second === undefined) {
    return [
      computed(
        "draw",
        "the designer was asked once; a second answer is asked only when the challenger answers a practice not " +
          "held or gives a finding",
      ),
    ];
  }
  return [
    computed("draw", firstFoundWords(second, "design")),
    ...listedLines("what the answer changed, by script", second.changes),
    computed("draw", decidingWords),
  ];
}

function saidLines(input: DesignCardInput): readonly CardLine[] {
  const notHeld = notHeldIds(input.practices);
  return input.said
    .filter((said) => notHeld.includes(said.id))
    .map((said) => judged(designerStep(input), `${said.id}, as the designer answered: ${said.sentence}`));
}

function findingLines(input: DesignCardInput): readonly CardLine[] {
  const heading = input.second === undefined ? "findings of the challenger" : "findings left after the answer";
  const count = input.findings.length === 0 ? "none" : String(input.findings.length);
  return [
    computed("draw", `${heading}: ${count}`),
    ...input.findings.map((finding) =>
      judged(challengerStep(input), `finding, in ${finding.where}: ${finding.wrong} Fix: ${finding.fix}`),
    ),
  ];
}

function notHeldLines(input: DesignCardInput): readonly CardLine[] {
  return input.practices
    .filter((practice) => practice.answer === "not-held")
    .map((practice) => notHeldLine(challengerStep(input), { id: practice.id, sentence: practice.sentence }));
}

function whatFacts(input: DesignCardInput, offered: string): readonly Fact[] {
  const by = designerStep(input);
  const conditions = counted(conditionsOf(input.requirements).length, "condition");
  const requirements = `requirements: ${input.file}: ${counted(input.requirements.outcomes.length, "outcome")}, ${conditions}`;
  return [
    ...shortFacts("what", [computed("draw", summaryWords(input.design)), computed("draw", coverageWords(input))]),
    ...facts("what", [
      computed("draw", `${answerWords(input)}; ${offered}`),
      computed("draw", requirements),
      ...input.design.modules.flatMap((module) => moduleLines(module, by)),
      ...input.design.interfaces.flatMap((each) => interfaceLines(each, by)),
      ...differenceLines(input),
      ...stayedLines(input.stayed ?? []),
    ]),
  ];
}

function checkFacts(input: DesignCardInput): readonly Fact[] {
  return [
    ...shortFacts("checks", [computed("draw", checkWords(input)), computed("draw", reviewWords(input))]),
    ...facts("checks", [
      computed("draw", examplesWords(input)),
      ...spelledLines(input),
      computed("draw", `practices held by the script's checks: ${joined(heldByRules)}`),
      computed("draw", tallyWords("the challenger", tallyOf(input.practices))),
      ...passLines(input),
      ...findingLines(input),
    ]),
  ];
}

function problemFacts(input: DesignCardInput): readonly Fact[] {
  const problems = input.problems.map((problem) => computed("draw", `problem: ${problem}`));
  return [...shortFacts("problems", [...problems, ...notHeldLines(input)]), ...facts("problems", saidLines(input))];
}

export function designCard(input: DesignCardInput): DesignCard {
  const reason = withheldReason(input);
  const offered = reason === undefined ? "approve is offered" : "approve is not offered";
  const lines = [...whatFacts(input, offered), ...checkFacts(input), ...problemFacts(input)];
  const title = `Commit the design of ${input.requirements.job}?`;
  return {
    card: { title, lines, withheld: reason === undefined ? {} : { approve: reason } },
    offered: { approve: reason === undefined },
  };
}
