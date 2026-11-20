import { tiers, type Json, type RunEvent, type Tier } from "../contracts.ts";
import { fieldOf, isRecord, textField, toJson } from "../json.ts";
import { failedWith, succeededWith, unplacedProblem, type Outcome } from "../outcome.ts";
import { foreachItemKey, workflowStepKey } from "./step-key.ts";
import { isGivenStep } from "./workflow-part.ts";

const marks = ["ran", "computed", "judged"] as const;

type Mark = (typeof marks)[number];

type StepSource = { readonly step: string; readonly item?: number };

type CommandSource = StepSource & {
  readonly command: string;
  readonly run?: string;
};

type SkillUsed = {
  readonly mode: string;
  readonly skill: string;
  readonly tier: Tier;
};

type GivenLine =
  | { readonly mark: "ran"; readonly words: string; readonly source: CommandSource }
  | { readonly mark: "computed" | "judged"; readonly words: string; readonly source: StepSource };

type InItem = { readonly foreach?: string };

type CardLine =
  | ({ readonly mark: "ran"; readonly words: string; readonly source: CommandSource } & InItem)
  | ({ readonly mark: "computed"; readonly words: string; readonly source: StepSource } & InItem)
  | ({
      readonly mark: "judged";
      readonly words: string;
      readonly source: StepSource;
      readonly skills: readonly SkillUsed[];
    } & InItem);

export type Card = {
  readonly title: string;
  readonly lines: readonly CardLine[];
  readonly counted: Readonly<Record<Mark, number>>;
};

type SkillSeen = SkillUsed & {
  readonly calledRuns?: readonly string[];
};

export type StepSeen = {
  readonly kind: string;
  readonly status: string;
  readonly skill: SkillSeen | undefined;
  readonly attempts?: readonly number[];
};

type CardContext = {
  readonly stepId: string;
  readonly quotes: readonly string[];
  readonly keys: ReadonlyMap<string, string>;
  readonly foreachOf: ReadonlyMap<string, string>;
  readonly steps: ReadonlyMap<string, StepSeen>;
  readonly events: readonly RunEvent[];
  readonly eventsOf: (runId: string) => Promise<readonly RunEvent[]>;
};

type Given = {
  readonly title: string;
  readonly lines: readonly Json[];
};

type Cited = {
  readonly id: string;
  readonly named: string;
  readonly key: string;
  readonly foreach?: string;
  readonly skills: readonly SkillUsed[];
  readonly calledRuns: readonly string[];
  readonly given: boolean;
};

const cardFields: readonly string[] = ["title", "lines", "withheld"];

const lineFields: readonly string[] = ["mark", "words", "source"];

const kernelLineFields: readonly string[] = ["skills", "foreach"];

const commandSourceFields: readonly string[] = ["step", "command", "run", "item"];

const stepSourceFields: readonly string[] = ["step", "item"];

function isCard(content: Json): boolean {
  return isRecord(content) && Object.hasOwn(content, "lines");
}

function givenCard(content: Json): Given | string {
  const stray = isRecord(content) ? Object.keys(content).find((field) => !cardFields.includes(field)) : undefined;
  if (stray !== undefined) {
    return `it has the field ${stray}, which a card does not take; a card has title, lines and withheld.`;
  }
  const title = textField(content, "title");
  const lines = fieldOf(content, "lines");
  if (title === undefined || title.trim() === "") {
    return "it has no title.";
  }
  if (!Array.isArray(lines)) {
    return "its lines are not a list.";
  }
  return { title, lines: lines.map((line: unknown) => toJson(line)) };
}

function strayField(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): string | undefined {
  return Object.keys(value).find((field) => !allowed.includes(field));
}

function itemSource(source: Readonly<Record<string, unknown>>, step: string): StepSource | string {
  if (!Object.hasOwn(source, "item")) {
    return { step };
  }
  const item = source["item"];
  return typeof item === "number" && Number.isSafeInteger(item) && item >= 0
    ? { step, item }
    : `has the source.item ${JSON.stringify(item ?? null)}; an item is counted from 0 as a whole number.`;
}

function commandSource(source: Readonly<Record<string, unknown>>, step: string): CommandSource | string {
  const stray = strayField(source, commandSourceFields);
  const command = textField(toJson(source), "command");
  const run = textField(toJson(source), "run");
  if (stray !== undefined) {
    return `has the field source.${stray}, which the source of a ran line does not take.`;
  }
  if (command === undefined) {
    return "is marked ran but names no command in its source.";
  }
  const cited = itemSource(source, step);
  if (typeof cited === "string") {
    return cited;
  }
  return run === undefined ? { ...cited, command } : { ...cited, command, run };
}

function stepSource(source: Readonly<Record<string, unknown>>, step: string, mark: Mark): StepSource | string {
  const stray = strayField(source, stepSourceFields);
  return stray === undefined
    ? itemSource(source, step)
    : `has the field source.${stray}, which the source of a ${mark} line does not take.`;
}

function isMark(value: Json | undefined): value is Mark {
  return marks.some((known) => known === value);
}

function markProblem(given: Json | undefined): string {
  const shown = typeof given === "string" ? given : JSON.stringify(given ?? null);
  return `has the mark ${shown}; a line is marked ran, computed or judged.`;
}

function sourcedLine(mark: Mark, words: string, source: Json | undefined): GivenLine | string {
  const step = source === undefined ? undefined : textField(source, "step");
  if (source === undefined || !isRecord(source) || step === undefined) {
    return "names no step in its source.";
  }
  switch (mark) {
    case "ran": {
      const cited = commandSource(source, step);
      return typeof cited === "string" ? cited : { mark, words, source: cited };
    }
    case "computed":
    case "judged": {
      const cited = stepSource(source, step, mark);
      return typeof cited === "string" ? cited : { mark, words, source: cited };
    }
  }
}

function givenLine(line: Json): GivenLine | string {
  if (!isRecord(line)) {
    return "is not a mapping of mark, words and source.";
  }
  const stray = strayField(line, lineFields);
  if (stray !== undefined) {
    return (
      `has the field ${stray}, which a line does not take; a line has mark, words and source, ` +
      "and the kernel adds the skill and tier of a judged line and the foreach of a step in an item."
    );
  }
  const mark = fieldOf(line, "mark");
  const words = textField(line, "words");
  if (!isMark(mark)) {
    return markProblem(mark);
  }
  return words === undefined ? "has no words." : sourcedLine(mark, words, fieldOf(line, "source"));
}

function isUnder(key: string, other: string): boolean {
  return other.startsWith(`${key}/`);
}

type Placed = {
  readonly named: string;
  readonly key: string | undefined;
  readonly foreach?: string;
  readonly given: boolean;
};

function plainPlace(context: CardContext, id: string): Placed | string {
  const foreach = context.foreachOf.get(id);
  if (foreach !== undefined && !context.keys.has(id)) {
    return `cites step ${id}, which runs in each item of step ${foreach}; a line names its item as source.item.`;
  }
  const key = context.keys.get(id);
  return { named: `step ${id}`, key, given: key !== undefined && isGivenStep(context.events, key) };
}

function itemPlace(context: CardContext, id: string, item: number): Placed | string {
  const foreach = context.foreachOf.get(id);
  if (foreach === undefined) {
    return `cites item ${String(item)} of step ${id}, which is not a step inside a foreach.`;
  }
  const named = `step ${id} in item ${String(item)} of ${foreach}`;
  const foreachKey = context.keys.get(foreach);
  if (foreachKey === undefined) {
    return { named, key: undefined, foreach, given: false };
  }
  const attempt = context.steps.get(foreachKey)?.attempts?.[item] ?? 1;
  const key = workflowStepKey(foreachItemKey(foreachKey, item, attempt), id);
  return { named, key, foreach, given: isGivenStep(context.events, foreachKey) };
}

function placeOf(context: CardContext, source: StepSource): Placed | string {
  return source.item === undefined ? plainPlace(context, source.step) : itemPlace(context, source.step, source.item);
}

function notFinished(named: string): string {
  return `cites ${named}, which has not finished in this run before the approval.`;
}

function recordProblem(named: string, record: StepSeen | undefined): string | undefined {
  if (record === undefined || record.status !== "done") {
    return notFinished(named);
  }
  return record.kind === "action"
    ? undefined
    : `cites ${named}, which is a ${record.kind} step; a line cites an action step.`;
}

function citedStep(context: CardContext, source: StepSource): Cited | string {
  const placed = placeOf(context, source);
  if (typeof placed === "string") {
    return placed;
  }
  const { named, key, given } = placed;
  if (key === undefined) {
    return notFinished(named);
  }
  const record = context.steps.get(key);
  const cited = { id: source.step, named, key, ...(placed.foreach === undefined ? {} : { foreach: placed.foreach }) };
  if (record === undefined && given) {
    return { ...cited, skills: [], calledRuns: [], given };
  }
  return recordProblem(named, record) ?? { ...cited, ...skillsUnder(context.steps, key), given };
}

function skillsUnder(steps: CardContext["steps"], key: string): Pick<Cited, "skills" | "calledRuns"> {
  const skills: SkillUsed[] = [];
  const calledRuns: string[] = [];
  for (const [under, step] of steps) {
    if (step.skill !== undefined && isUnder(key, under)) {
      const { mode, skill, tier } = step.skill;
      skills.push({ mode, skill, tier });
      calledRuns.push(...(step.skill.calledRuns ?? []));
    }
  }
  return { skills, calledRuns };
}

function computedProblem(cited: Cited): string | undefined {
  const skill = cited.skills[0];
  return skill === undefined
    ? undefined
    : `is marked computed but cites ${cited.named}, which ran the skill ${skill.skill} of mode ${skill.mode}; ` +
        "a computed line cites a step that ran no skill.";
}

function judgedProblem(context: CardContext, cited: Cited): string | undefined {
  if (!context.quotes.includes(cited.id)) {
    const listed = context.quotes.length === 0 ? "none" : context.quotes.join(", ");
    return (
      `is marked judged but cites ${cited.named}, which the approval does not list under quotes ` +
      `(it lists: ${listed}).`
    );
  }
  return cited.skills.length > 0 || cited.given
    ? undefined
    : `is marked judged but cites ${cited.named}, which ran no skill; ` +
        "a judged line cites a skill step the approval lists under quotes.";
}

function isCommand(event: RunEvent, name: string): boolean {
  return event.kind === "command" && textField(event.detail, "name") === name;
}

async function ranProblem(context: CardContext, cited: Cited, source: CommandSource): Promise<string | undefined> {
  const { command, run } = source;
  if (run === undefined) {
    const stepOf = (event: RunEvent): string => textField(event.detail, "step") ?? "";
    const found = context.events.some((event) => isCommand(event, command) && isUnder(cited.key, stepOf(event)));
    return found
      ? undefined
      : `is marked ran but cites the command ${command} of ${cited.named}, ` +
          `and the kernel recorded no command ${command} in that step.`;
  }
  if (!cited.calledRuns.includes(run)) {
    return (
      `is marked ran but cites run ${run}, which no skill of ${cited.named} called; ` +
      "a ran line cites a command of this run or of a run that one of its skills called."
    );
  }
  const found = (await context.eventsOf(run)).some((event) => isCommand(event, command));
  return found
    ? undefined
    : `is marked ran but cites the command ${command} in run ${run}, and the kernel recorded no command ${command} there.`;
}

async function checkedLine(context: CardContext, line: Json): Promise<CardLine | string> {
  const given = givenLine(line);
  if (typeof given === "string") {
    return given;
  }
  const cited = citedStep(context, given.source);
  if (typeof cited === "string") {
    return cited;
  }
  const inItem = cited.foreach === undefined ? {} : { foreach: cited.foreach };
  switch (given.mark) {
    case "ran":
      return (await ranProblem(context, cited, given.source)) ?? { ...given, ...inItem };
    case "computed":
      return computedProblem(cited) ?? { mark: "computed", words: given.words, source: given.source, ...inItem };
    case "judged":
      return judgedProblem(context, cited) ?? { ...given, mark: "judged", skills: cited.skills, ...inItem };
  }
}

function countedOf(lines: readonly CardLine[]): Readonly<Record<Mark, number>> {
  const count = (mark: Mark): number => lines.filter((line) => line.mark === mark).length;
  return { ran: count("ran"), computed: count("computed"), judged: count("judged") };
}

export async function checkedCard(content: Json, context: CardContext): Promise<Outcome<Card | undefined>> {
  if (!isCard(content)) {
    return succeededWith(undefined);
  }
  const cannot = `Step ${context.stepId} cannot show its card`;
  const given = givenCard(content);
  if (typeof given === "string") {
    return failedWith([unplacedProblem(`${cannot}: ${given}`)]);
  }
  const lines: CardLine[] = [];
  const problems: string[] = [];
  for (const [index, line] of given.lines.entries()) {
    const checked = await checkedLine(context, line);
    if (typeof checked === "string") {
      problems.push(`${cannot}: line ${String(index + 1)} ${checked}`);
    } else {
      lines.push(checked);
    }
  }
  if (problems.length > 0) {
    return failedWith(problems.map((message) => unplacedProblem(message)));
  }
  return succeededWith({ title: given.title, lines, counted: countedOf(lines) });
}

function malformedCard(): Error {
  return new Error("kernel.db holds an approval step whose detail has no valid card.");
}

function storedSkills(value: Json | undefined): readonly SkillUsed[] {
  if (!Array.isArray(value)) {
    throw malformedCard();
  }
  return value.map((element: unknown) => {
    const entry = toJson(element);
    const mode = textField(entry, "mode");
    const skill = textField(entry, "skill");
    const tier = tiers.find((known) => known === textField(entry, "tier"));
    if (mode === undefined || skill === undefined || tier === undefined) {
      throw malformedCard();
    }
    return { mode, skill, tier };
  });
}

function storedForeach(entry: Json, source: StepSource): InItem {
  const foreach = textField(entry, "foreach");
  if ((foreach === undefined) !== (source.item === undefined)) {
    throw malformedCard();
  }
  return foreach === undefined ? {} : { foreach };
}

function storedLine(value: unknown): CardLine {
  const entry = toJson(value);
  const given = isRecord(entry) ? Object.entries(entry).filter(([key]) => !kernelLineFields.includes(key)) : [];
  const line = givenLine(toJson(Object.fromEntries(given)));
  if (typeof line === "string") {
    throw malformedCard();
  }
  const inItem = storedForeach(entry, line.source);
  switch (line.mark) {
    case "ran":
      return { ...line, ...inItem };
    case "computed":
      return { mark: "computed", words: line.words, source: line.source, ...inItem };
    case "judged": {
      const skills = storedSkills(fieldOf(entry, "skills"));
      return { mark: "judged", words: line.words, source: line.source, skills, ...inItem };
    }
  }
}

export function storedCardOf(value: Json | undefined): Card | undefined {
  if (value === undefined) {
    return undefined;
  }
  const title = textField(value, "title");
  const lines = fieldOf(value, "lines");
  if (title === undefined || !Array.isArray(lines)) {
    throw malformedCard();
  }
  const stored = lines.map(storedLine);
  return { title, lines: stored, counted: countedOf(stored) };
}
