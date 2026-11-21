import type { Chosen, Finding } from "./challenge-answer.ts";
import { computed, counted, joined, judged, type Card, type CardLine } from "./card-lines.ts";
import {
  actionsOf,
  type Action,
  type Design,
  type DesignerAnswer,
  type Interface,
  type Module,
} from "./design-form.ts";
import { heldByRules, ruleCount } from "./design-rules.ts";
import type { DesignPath } from "./path-card.ts";
import { notHeldIds, notHeldReason, practiceLines, type PracticeAnswer } from "./practice-answers.ts";
import { conditionsOf, type Requirements } from "./requirements-form.ts";

export type DesignCardInput = {
  readonly file: string;
  readonly requirements: Requirements;
  readonly path: DesignPath;
  readonly chosen: Chosen;
  readonly because: string;
  readonly design: Design;
  readonly problems: readonly string[];
  readonly refusedSchemas: number;
  readonly practices: readonly PracticeAnswer[];
  readonly findings: readonly Finding[];
  readonly said: readonly DesignerAnswer[];
  readonly differences: readonly string[];
  readonly second?: SecondPass;
};

export type SecondPass = {
  readonly notHeld: readonly string[];
  readonly findings: number;
  readonly changes: readonly string[];
};

export type DesignCard = {
  readonly card: Card & { readonly withheld: { readonly approve?: string } };
  readonly offered: { readonly approve: boolean };
};

const designers = "designs";

const challenger = "challenge";

const answeringDesigner = "design-again";

const secondChallenger = "challenge-again";

const differencesShown = 8;

const answeredOnce = "The designer has answered the challenge once, which is the most a design run asks.";

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
  const notHeld = notHeldReason(input.practices, "design");
  const reasons = [
    ...(input.problems.length === 0 ? [] : [`The design check found ${counted(input.problems.length, "problem")}.`]),
    ...notHeld,
    ...(notHeld.length > 0 && input.second !== undefined ? [answeredOnce] : []),
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

function moduleLines(module: Module, by: string): readonly CardLine[] {
  return [
    computed("draw", `module ${module.name}: implements ${joined(module.implements)}; ${ownsWords(module)}`),
    judged(by, `${module.name} hides: ${module.hides}`),
  ];
}

function servesWords(action: Action): string {
  if (action.serves.length === 0) {
    return `serves no condition: ${action.because ?? ""}`;
  }
  return `serves ${action.serves.join(", ")}`;
}

function interfaceLines(each: Interface): readonly CardLine[] {
  const heading = `interface ${each.name}: ${counted(each.actions.length, "action")}, ${counted(
    each.actions.length * 2,
    "schema file",
  )}`;
  const actions = each.actions.map((action) =>
    computed("draw", `${action.name}: ${servesWords(action)}; ${counted(action.examples.length, "example")}`),
  );
  return [computed("draw", heading), ...actions];
}

function coverageWords(input: DesignCardInput): string {
  const served = actionsOf(input.design).flatMap((action) => action.serves);
  const missed = conditionsOf(input.requirements).filter((condition) => !served.includes(condition));
  return missed.length === 0
    ? "coverage: every condition is served by an action: yes"
    : `coverage: no action serves ${missed.join(", ")}`;
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

function checkLines(input: DesignCardInput): readonly CardLine[] {
  const found = input.problems.length === 0 ? "no problem" : counted(input.problems.length, "problem");
  return [
    computed("draw", coverageWords(input)),
    computed("draw", `checked by script: ${String(ruleCount)} rules of the design, ${found}`),
    ...input.problems.map((problem) => computed("draw", `problem: ${problem}`)),
    computed("draw", examplesWords(input)),
  ];
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

function firstFoundWords(second: SecondPass): string {
  const notHeld = second.notHeld.length === 0 ? [] : [`answered ${joined(second.notHeld)} not held`];
  const findings = second.findings === 0 ? [] : [`gave ${counted(second.findings, "finding")}`];
  return `the first challenge ${joined([...notHeld, ...findings])}; the designer answered once`;
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
    computed("draw", firstFoundWords(second)),
    ...listedLines("what the answer changed, by script", second.changes),
    computed("draw", "the second challenge's answers decide the card"),
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

export function designCard(input: DesignCardInput): DesignCard {
  const reason = withheldReason(input);
  const offered = reason === undefined ? "approve is offered" : "approve is not offered";
  const by = designerStep(input);
  const conditions = counted(conditionsOf(input.requirements).length, "condition");
  const lines = [
    computed("draw", `${answerWords(input)}; ${offered}`),
    computed(
      "draw",
      `requirements: ${input.file}: ${counted(input.requirements.outcomes.length, "outcome")}, ${conditions}`,
    ),
    ...input.design.modules.flatMap((module) => moduleLines(module, by)),
    ...input.design.interfaces.flatMap(interfaceLines),
    ...checkLines(input),
    ...passLines(input),
    ...practiceLines({ answers: input.practices, heldByRules, challenger: challengerStep(input) }),
    ...saidLines(input),
    ...findingLines(input),
    ...differenceLines(input),
  ];
  const title = `Commit the design of ${input.requirements.job}?`;
  return {
    card: { title, lines, withheld: reason === undefined ? {} : { approve: reason } },
    offered: { approve: reason === undefined },
  };
}
