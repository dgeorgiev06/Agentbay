import { itemWords, skillWords, wordsOf, type Approval, type CardLine, type Choice } from "./approval-words.ts";
import { counted, joinedWith } from "./item-words.ts";
import { headings, kernelWords, moreWords, sections, type Section } from "./screen-words.ts";
import { shown } from "./trust.ts";
import { hanging } from "./trust-card.ts";

type Fact = CardLine & { readonly section: Section };

type Withheld = Extract<Choice, { readonly status: "withheld" }>;

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

type Indent = { readonly lead: string; readonly fact: string };

const shortRows = 4;

const atTop: Indent = { lead: "  ", fact: "    " };

const inBlock: Indent = { lead: "    ", fact: "      " };

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
  return sections.find((section) => section === name);
}

export function sectionNames(): string {
  return sections.join(", ");
}

function rowsOf(text: string, first: string, rest = `${first}  `): Rows {
  return hanging(wordsOf(text), { first, rest });
}

function spaced(parts: readonly Rows[]): Rows {
  return parts.filter((part) => part.length > 0).flatMap((part, index) => (index === 0 ? part : ["", ...part]));
}

function withheldOf(choices: readonly Choice[]): readonly Withheld[] {
  return choices.flatMap((choice) => (choice.status === "withheld" ? [choice] : []));
}

function sectionsOf(screen: Screen): readonly InSection[] {
  return sections.flatMap((section) => {
    const facts = screen.facts.filter((fact) => fact.section === section);
    const shownAnyway = section === "problems" && withheldOf(screen.choices).length > 0;
    return facts.length === 0 && !shownAnyway ? [] : [{ section, facts }];
  });
}

function titleRows(title: string): Rows {
  return rowsOf(title.toUpperCase(), "", "");
}

function withheldRows(choices: readonly Choice[]): Rows {
  return withheldOf(choices).flatMap((choice) => [
    ...rowsOf(`${kernelWords.cannotReply} ${choice.name} now: ${choice.does}`, "  "),
    ...rowsOf(`${kernelWords.why} ${choice.reason}`, "    "),
  ]);
}

function leadOf(fact: Fact): string | undefined {
  switch (fact.mark) {
    case "computed":
      return undefined;
    case "judged":
      return `${kernelWords.modelWrote}:`;
    case "ran":
      return `${fact.source.command} ${kernelWords.reported}`;
  }
}

function shortRowsOf(fact: Fact, previous: Fact | undefined): Rows {
  const lead = leadOf(fact);
  if (lead === undefined) {
    return rowsOf(fact.words, "  ");
  }
  const led = previous !== undefined && leadOf(previous) === lead ? [] : rowsOf(lead, "  ");
  return [...led, ...rowsOf(fact.words, "    ")];
}

function allFactRows(facts: readonly Fact[]): Rows {
  return facts.flatMap((fact, index) => shortRowsOf(fact, facts[index - 1]));
}

function cappedFactRows(facts: readonly Fact[]): Rows {
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
  return more === 0 ? rows : [...rows, `  ${moreWords(more)}`];
}

function shortSection(screen: Screen, { section, facts }: InSection): Rows {
  if (section === "problems") {
    return [headings.problems, ...withheldRows(screen.choices), ...allFactRows(facts)];
  }
  return [headings[section], ...cappedFactRows(facts)];
}

function offeredRows(choices: readonly Choice[]): Rows {
  const offered = choices.filter((choice) => choice.status === "offered");
  const rows = offered.flatMap((choice) => rowsOf(`${choice.name}: ${choice.does}`, "  "));
  return rows.length === 0 ? [] : [kernelWords.eachReply, ...rows];
}

function replyLine(choices: readonly Choice[]): Rows {
  const offered = choices.filter((choice) => choice.status === "offered").map((choice) => choice.name);
  const names = choices.length === 0 ? ["approve", "reject"] : offered;
  const words = names.length === 0 ? "no reply is available now" : joinedWith(names, "or");
  return rowsOf(`${kernelWords.reply} ${words}`, "");
}

export function screenLines(screen: Screen, runId: string): Rows {
  return spaced([
    titleRows(screen.title),
    ...sectionsOf(screen).map((each) => shortSection(screen, each)),
    offeredRows(screen.choices),
    [...replyLine(screen.choices), kernelWords.details, `  bay runs ${shown(runId)} --details`],
  ]);
}

function sourceWords(fact: Fact): string {
  const at = `in step ${fact.source.step}${itemWords(fact)}`;
  switch (fact.mark) {
    case "computed":
      return `${kernelWords.scriptWorked}, ${at}:`;
    case "judged": {
      const skills = fact.skills.length === 0 ? "" : ` (${fact.skills.map(skillWords).join("; ")})`;
      return `${kernelWords.modelWrote} this, ${at}${skills}:`;
    }
    case "ran": {
      const run = fact.source.run === undefined ? "" : `, in run ${fact.source.run}`;
      return `${kernelWords.toolRan} ${fact.source.command}${run}, ${at}:`;
    }
  }
}

type Run = { readonly first: Fact; readonly facts: readonly Fact[] };

function runsOf(facts: readonly Fact[], keyOf: (fact: Fact) => string | undefined): readonly Run[] {
  return facts.reduce<readonly Run[]>((runs, fact) => {
    const last = runs.at(-1);
    if (last !== undefined && keyOf(last.first) === keyOf(fact)) {
      return [...runs.slice(0, -1), { first: last.first, facts: [...last.facts, fact] }];
    }
    return [...runs, { first: fact, facts: [fact] }];
  }, []);
}

function sourcedRows(facts: readonly Fact[], indent: Indent): Rows {
  return runsOf(facts, sourceWords).flatMap((run) => [
    ...rowsOf(sourceWords(run.first), indent.lead),
    ...run.facts.flatMap((fact) => rowsOf(fact.words, indent.fact)),
  ]);
}

function blockRows({ first, facts }: Run): Rows {
  const { about } = first;
  return about === undefined ? sourcedRows(facts, atTop) : [...rowsOf(about, "  "), ...sourcedRows(facts, inBlock)];
}

function sectionDetails(screen: Screen, { section, facts }: InSection): Rows {
  const withheld = section === "problems" ? withheldRows(screen.choices) : [];
  return [headings[section], ...withheld, ...runsOf(facts, (fact) => fact.about).flatMap(blockRows)];
}

function contentsRows(listed: readonly InSection[], runId: string): Rows {
  const counts = listed.map(({ section, facts }) => `  ${headings[section]}: ${counted(facts.length, "fact")}`);
  const named = joinedWith(
    listed.map(({ section }) => section),
    "or",
  );
  return [
    kernelWords.contents,
    ...counts,
    `  ${kernelWords.oneSection}`,
    `    bay runs ${runId} --details --section <name>`,
    ...rowsOf(`where <name> is ${named}.`, "  "),
  ];
}

function producedRows(facts: readonly Fact[]): Rows {
  const count = (mark: Fact["mark"]): number => facts.filter((fact) => fact.mark === mark).length;
  const words =
    `${counted(count("computed"), "fact")} worked out by scripts, ${String(count("judged"))} written by a model, ` +
    `${String(count("ran"))} from tools.`;
  return [`  ${kernelWords.producedBy}`, ...rowsOf(words, "    ")];
}

function recordRows(screen: Screen, record: ScreenRecord): Rows {
  return [
    kernelWords.record,
    ...producedRows(screen.facts),
    ...rowsOf(kernelWords.copying, "  ", "  "),
    `  ${kernelWords.steps}`,
    ...record.steps.map((step) => `    ${shown(step)}`),
    `  ${kernelWords.fullHash}`,
    `    ${screen.hash}`,
    `  ${kernelWords.decide}`,
    `    ${shown(record.decide)}`,
  ];
}

function oneSection(screen: Screen, runId: string, section: Section): Rows {
  const chosen = sectionsOf(screen).find((each) => each.section === section);
  const shownFacts =
    chosen === undefined ? [headings[section], `  ${kernelWords.noFacts}`] : sectionDetails(screen, chosen);
  return spaced([
    [...titleRows(screen.title), kernelWords.sectionOfDetails],
    shownFacts,
    [kernelWords.wholeView, `  bay runs ${runId} --details`],
  ]);
}

export function detailsLines(screen: Screen, record: ScreenRecord, section?: Section): Rows {
  const runId = shown(record.runId);
  if (section !== undefined) {
    return oneSection(screen, runId, section);
  }
  const listed = sectionsOf(screen);
  return spaced([
    [...titleRows(screen.title), kernelWords.everyFact],
    contentsRows(listed, runId),
    ...listed.map((each) => sectionDetails(screen, each)),
    offeredRows(screen.choices),
    replyLine(screen.choices),
    recordRows(screen, record),
  ]);
}
