import { itemWords, skillWords, wordsOf, type Approval, type CardLine, type Choice } from "./approval-words.ts";
import { shown } from "./trust.ts";
import { hanging } from "./trust-card.ts";

export type Section = NonNullable<CardLine["section"]>;

type Fact = CardLine & { readonly section: Section };

export type Screen = {
  readonly title: string;
  readonly facts: readonly Fact[];
  readonly choices: readonly Choice[];
  readonly hash: string;
};

export type ScreenRecord = {
  readonly runId: string;
  readonly steps: readonly string[];
  readonly decide: string;
};

type Rows = readonly string[];

type InSection = { readonly section: Section; readonly facts: readonly Fact[] };

const headings: Readonly<Record<Section, string>> = {
  what: "What it is",
  checks: "Checks",
  open: "Not decided",
  problems: "Problems",
};

const order: readonly Section[] = ["what", "checks", "open", "problems"];

const shortRows = 4;

function isFact(line: CardLine): line is Fact {
  return line.section !== undefined;
}

export function screenOf(approval: Approval): Screen | undefined {
  const lines = approval.card?.lines ?? [];
  const facts = lines.filter(isFact);
  if (approval.card === undefined || facts.length === 0 || facts.length < lines.length) {
    return undefined;
  }
  return { title: approval.card.title, facts, choices: approval.choices ?? [], hash: approval.hash };
}

export function sectionNamed(name: string): Section | undefined {
  return order.find((section) => section === name);
}

export function sectionNames(): string {
  return order.join(", ");
}

function rowsOf(text: string, first: string, rest: string): Rows {
  return hanging(wordsOf(text), { first, rest });
}

function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function orWords(names: readonly string[]): string {
  if (names.length < 2) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1) ?? ""}`;
}

function spaced(parts: readonly Rows[]): Rows {
  return parts.filter((part) => part.length > 0).flatMap((part, index) => (index === 0 ? part : ["", ...part]));
}

function sectionsOf(facts: readonly Fact[]): readonly InSection[] {
  return order.flatMap((section) => {
    const inSection = facts.filter((fact) => fact.section === section);
    return inSection.length === 0 ? [] : [{ section, facts: inSection }];
  });
}

function titleRows(title: string): Rows {
  return rowsOf(title.toUpperCase(), "", "");
}

function leadOf(fact: Fact): string | undefined {
  switch (fact.mark) {
    case "computed":
      return undefined;
    case "judged":
      return "A model wrote:";
    case "ran":
      return `${fact.source.command} reported:`;
  }
}

function shortRowsOf(fact: Fact, previous: Fact | undefined): Rows {
  const lead = leadOf(fact);
  if (lead === undefined) {
    return rowsOf(fact.words, "  ", "    ");
  }
  const led = previous !== undefined && leadOf(previous) === lead ? [] : rowsOf(lead, "  ", "    ");
  return [...led, ...rowsOf(fact.words, "    ", "      ")];
}

function shortFactRows(facts: readonly Fact[]): Rows {
  const short = facts.filter((fact) => fact.short === true);
  const rows: string[] = [];
  let previous: Fact | undefined;
  let shownFacts = 0;
  for (const [index, fact] of short.entries()) {
    const factRows = shortRowsOf(fact, previous);
    const factsLeft = index < short.length - 1 || short.length < facts.length;
    if (rows.length + factRows.length > shortRows - (factsLeft ? 1 : 0)) {
      break;
    }
    rows.push(...factRows);
    previous = fact;
    shownFacts += 1;
  }
  const more = facts.length - shownFacts;
  return more === 0 ? rows : [...rows, `  and ${String(more)} more, see details`];
}

function choiceRows(choice: Choice): Rows {
  return rowsOf(`${choice.name}: ${choice.does}`, "  ", "    ");
}

function replyRows(choices: readonly Choice[]): Rows {
  const offered = choices.filter((choice) => choice.status === "offered");
  const withheld = choices.flatMap((choice) => (choice.status === "withheld" ? [choice] : []));
  const doing = offered.length === 0 ? [] : ["What each reply does", ...offered.flatMap(choiceRows)];
  const notNow = withheld.flatMap((choice) => [
    ...choiceRows(choice),
    ...rowsOf(`Why: ${choice.reason}`, "    ", "      "),
  ]);
  return [...doing, ...(notNow.length === 0 ? [] : ["Not available now", ...notNow])];
}

function replyLine(choices: readonly Choice[]): Rows {
  const offered = choices.filter((choice) => choice.status === "offered").map((choice) => choice.name);
  const names = choices.length === 0 ? ["approve", "reject"] : offered;
  return names.length === 0 ? ["Reply: no reply is available now"] : rowsOf(`Reply: ${orWords(names)}`, "", "  ");
}

export function screenLines(screen: Screen, runId: string): Rows {
  return spaced([
    titleRows(screen.title),
    ...sectionsOf(screen.facts).map(({ section, facts }) => [headings[section], ...shortFactRows(facts)]),
    replyRows(screen.choices),
    [...replyLine(screen.choices), "Details:", `  bay runs ${shown(runId)} --details`],
  ]);
}

function byWords(fact: Fact): string {
  const at = `in step ${fact.source.step}${itemWords(fact)}`;
  switch (fact.mark) {
    case "computed":
      return `A script worked it out, ${at}:`;
    case "judged": {
      const skills = fact.skills.length === 0 ? "" : ` (${fact.skills.map(skillWords).join("; ")})`;
      return `A model wrote, ${at}${skills}:`;
    }
    case "ran": {
      const run = fact.source.run === undefined ? "" : ` in run ${fact.source.run}`;
      return `The command ${fact.source.command} ran${run}, ${at}:`;
    }
  }
}

function detailFactRows(facts: readonly Fact[]): Rows {
  return facts.flatMap((fact, index) => {
    const by = byWords(fact);
    const before = facts[index - 1];
    const group = before !== undefined && byWords(before) === by ? [] : rowsOf(by, "  ", "    ");
    return [...group, ...rowsOf(fact.words, "    ", "      ")];
  });
}

function sectionDetails({ section, facts }: InSection): Rows {
  return [headings[section], ...detailFactRows(facts)];
}

function contentsRows(sections: readonly InSection[], runId: string): Rows {
  const listed = sections.map(({ section, facts }) => `  ${headings[section]}: ${counted(facts.length, "fact")}`);
  const named = orWords(sections.map(({ section }) => section));
  return [
    "In this view",
    ...listed,
    "  One section alone:",
    `    bay runs ${runId} --details --section <name>`,
    ...rowsOf(`where <name> is ${named}.`, "  ", "    "),
  ];
}

function recordRows(screen: Screen, record: ScreenRecord): Rows {
  return [
    "For the record",
    ...rowsOf("These lines are for copying, so they are not wrapped.", "  ", "  "),
    "  The steps of this run:",
    ...record.steps.map((step) => `    ${shown(step)}`),
    "  The full hash:",
    `    ${screen.hash}`,
    "  Decide with:",
    `    ${shown(record.decide)}`,
  ];
}

function oneSection(screen: Screen, runId: string, section: Section): Rows {
  const facts = screen.facts.filter((fact) => fact.section === section);
  const shownFacts =
    facts.length === 0 ? [headings[section], "  It has no facts."] : sectionDetails({ section, facts });
  return spaced([
    [...titleRows(screen.title), "One section of the details."],
    shownFacts,
    ["The whole view:", `  bay runs ${runId} --details`],
  ]);
}

export function detailsLines(screen: Screen, record: ScreenRecord, section?: Section): Rows {
  const runId = shown(record.runId);
  if (section !== undefined) {
    return oneSection(screen, runId, section);
  }
  const sections = sectionsOf(screen.facts);
  return spaced([
    [...titleRows(screen.title), "Every fact this approval rests on."],
    contentsRows(sections, runId),
    ...sections.map(sectionDetails),
    replyRows(screen.choices),
    replyLine(screen.choices),
    recordRows(screen, record),
  ]);
}
