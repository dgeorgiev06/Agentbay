import type { CardLine } from "../scripts/lib/card-lines.ts";

export type PrintedChoice = {
  readonly name: string;
  readonly does: string;
  readonly withheld?: string;
};

export const widest = 44;

const widestName = 16;

function fittedRows(tokens: readonly string[], rooms: { readonly first: number; readonly rest: number }): string[] {
  const rows: string[] = [];
  const roomNow = (): number => (rows.length === 0 ? rooms.first : rooms.rest);
  let row = "";
  for (const token of tokens) {
    const longer = row === "" ? token : `${row} ${token}`;
    if (Array.from(longer).length <= roomNow()) {
      row = longer;
      continue;
    }
    if (row !== "") {
      rows.push(row);
    }
    let left = Array.from(token);
    while (left.length > roomNow()) {
      const room = roomNow();
      rows.push(left.slice(0, room).join(""));
      left = left.slice(room);
    }
    row = left.join("");
  }
  return [...rows, row];
}

function hanging(words: string, first: string, rest: string): readonly string[] {
  const rows = fittedRows(words.split(" "), { first: widest - first.length, rest: widest - rest.length });
  return rows.map((row, index) => `${index === 0 ? first : rest}${row}`);
}

function sharesStep(line: CardLine, next: CardLine | undefined): boolean {
  return next !== undefined && next.mark === line.mark && next.source.step === line.source.step;
}

function lineRows(lines: readonly CardLine[], skills: Readonly<Record<string, string>>): readonly string[] {
  return lines.flatMap((line, index) => {
    if (line.mark === "computed") {
      return hanging(line.words, "  ", "    ");
    }
    const rows = hanging(line.words, "judged   ", "judged     ");
    if (sharesStep(line, lines[index + 1])) {
      return rows;
    }
    return [...rows, ...hanging(`by ${skills[line.source.step] ?? ""}`, "judged    ", "judged      ")];
  });
}

function choiceGroup(heading: string, choices: readonly PrintedChoice[]): readonly string[] {
  if (choices.length === 0) {
    return [];
  }
  const nameWidth = Math.min(widestName, Math.max(...choices.map((choice) => choice.name.length)));
  const blank = " ".repeat(nameWidth + 4);
  const room = widest - blank.length;
  return [
    heading,
    ...choices.flatMap((choice) => {
      const does = fittedRows(choice.does.split(" "), { first: room, rest: room });
      const why =
        choice.withheld === undefined
          ? []
          : fittedRows(["why:", ...choice.withheld.split(" ")], { first: room, rest: room });
      const alone = choice.name.length > nameWidth;
      const named = does.map((row, index) =>
        index === 0 && !alone ? `  ${choice.name.padEnd(nameWidth)}  ${row}` : `${blank}${row}`,
      );
      return [...(alone ? [`  ${choice.name}`] : []), ...named, ...why.map((row) => `${blank}${row}`)];
    }),
  ];
}

function footRow(lines: readonly CardLine[]): string {
  const judged = lines.filter((line) => line.mark === "judged").length;
  return judged === 0 ? "All lines worked out by script." : "Unmarked lines were worked out by script.";
}

function countedRow(lines: readonly CardLine[]): string {
  const judged = lines.filter((line) => line.mark === "judged").length;
  return `checked: 0 ran, ${String(lines.length - judged)} computed, ${String(judged)} judged`;
}

export function printed(
  card: { readonly title: string; readonly lines: readonly CardLine[] },
  choices: readonly PrintedChoice[] = [],
  skills: Readonly<Record<string, string>> = {},
): string {
  return [
    ...hanging(card.title, "", "  "),
    ...lineRows(card.lines, skills),
    footRow(card.lines),
    ...choiceGroup(
      "You can:",
      choices.filter((choice) => choice.withheld === undefined),
    ),
    ...choiceGroup(
      "Not available:",
      choices.filter((choice) => choice.withheld !== undefined),
    ),
    countedRow(card.lines),
  ].join("\n");
}
