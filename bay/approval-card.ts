import { screenLines, screenOf } from "./approval-screen.ts";
import {
  itemWords,
  skillWords,
  wordsOf,
  type Approval,
  type Card,
  type CardLine,
  type Choice,
} from "./approval-words.ts";
import { shown } from "./trust.ts";
import { hanging, hashLine, namedRows } from "./trust-card.ts";

type Withheld = Extract<Choice, { readonly status: "withheld" }>;

type Segment = { readonly label: string; readonly tokens: readonly string[] };

const markColumn = "computed".length + 1;

const continued = "  ";

const unmarked = "  ";

function marked(mark: CardLine["mark"], words: string, indent: string): readonly string[] {
  const lead = `${mark.padEnd(markColumn)}${indent}`;
  return hanging(wordsOf(words), { first: lead, rest: `${lead}${continued}` });
}

function unmarkedRows(words: string): readonly string[] {
  return hanging(wordsOf(words), { first: unmarked, rest: `${unmarked}${continued}` });
}

function sourceWords(line: CardLine): string | undefined {
  switch (line.mark) {
    case "computed":
      return undefined;
    case "ran": {
      const { command, run } = line.source;
      const by = run === undefined ? `by the command ${command}` : `by the command ${command} in run ${run}`;
      return `${by}${itemWords(line)}`;
    }
    case "judged":
      return line.skills.length === 0 ? undefined : `by ${line.skills.map(skillWords).join("; ")}${itemWords(line)}`;
  }
}

function sharesSource(line: CardLine, next: CardLine | undefined): boolean {
  const sameStep = next?.source.step === line.source.step && next.source.item === line.source.item;
  if (next === undefined || next.mark !== line.mark || !sameStep) {
    return false;
  }
  return (
    line.mark !== "ran" ||
    next.mark !== "ran" ||
    (next.source.command === line.source.command && next.source.run === line.source.run)
  );
}

function lineRows(lines: readonly CardLine[]): readonly string[] {
  return lines.flatMap((line, index) => {
    if (line.mark === "computed") {
      return unmarkedRows(line.words);
    }
    const rows = marked(line.mark, line.words, "");
    const source = sourceWords(line);
    if (source === undefined || sharesSource(line, lines[index + 1])) {
      return rows;
    }
    return [...rows, ...marked(line.mark, source, " ")];
  });
}

function footRows(lines: readonly CardLine[]): readonly string[] {
  const computed = lines.filter((line) => line.mark === "computed").length;
  if (computed === 0) {
    return [];
  }
  return [computed === lines.length ? "All lines worked out by script." : "Unmarked lines were worked out by script."];
}

function namedSegment(choice: Choice): Segment {
  return { label: shown(choice.name), tokens: wordsOf(choice.does) };
}

function withheldSegments(choice: Withheld): readonly Segment[] {
  return [namedSegment(choice), { label: "", tokens: ["why:", ...wordsOf(choice.reason)] }];
}

function group(heading: string, rows: readonly (readonly Segment[])[]): readonly string[] {
  return rows.length === 0 ? [] : [heading, ...namedRows(rows)];
}

function choiceRows(choices: readonly Choice[] | undefined): readonly string[] {
  if (choices === undefined) {
    return [];
  }
  const offered = choices.filter((choice) => choice.status === "offered");
  const withheld = choices.flatMap((choice) => (choice.status === "withheld" ? [choice] : []));
  return [
    ...group(
      "You can:",
      offered.map((choice) => [namedSegment(choice)]),
    ),
    ...group("Not available:", withheld.map(withheldSegments)),
  ];
}

function countedLine(counted: Card["counted"]): string {
  return `checked: ${String(counted.ran)} ran, ${String(counted.computed)} computed, ${String(counted.judged)} judged`;
}

function cardRows(approval: Approval, card: Card): readonly string[] {
  return [
    ...hanging(wordsOf(card.title), { first: "", rest: unmarked }),
    ...lineRows(card.lines),
    ...footRows(card.lines),
    ...choiceRows(approval.choices),
    countedLine(card.counted),
    hashLine(approval.hash),
  ];
}

export function approvalLines(approval: Approval, runId: string): readonly string[] {
  const { card } = approval;
  const screen = screenOf(approval);
  if (screen !== undefined) {
    return screenLines(screen, runId);
  }
  if (card !== undefined) {
    return cardRows(approval, card);
  }
  return [
    `approval: ${approval.question}`,
    `shown content (hash ${approval.hash}):`,
    JSON.stringify(approval.content, null, 2),
    ...choiceRows(approval.choices),
  ];
}
