export type Practice = {
  readonly id: string;
  readonly says: string;
};

type Row = Practice & {
  readonly heldBy: string;
};

const practiceId = /^[A-Z]{1,4}-\d{1,3}$/;

const heading = /^##\s+([A-Z]{1,4}-\d{1,3})\s+(.+)$/;

const heldByLine = /^Held by:\s*(.*?)(?:\.\s+Source:.*)?$/;

const reviewersWords = ["review", "planned check", "check planned"];

const designWords = ["design"];

function cellsOf(line: string): readonly string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function tableRow(line: string): Row | undefined {
  if (!line.trim().startsWith("|")) {
    return undefined;
  }
  const cells = cellsOf(line);
  const [id = "", ...rest] = cells;
  const heldBy = rest.at(-1);
  if (!practiceId.test(id) || heldBy === undefined || rest.length < 2) {
    return undefined;
  }
  return { id, says: rest.slice(0, -1).join(" | "), heldBy };
}

function headedRow(lines: readonly string[], at: number): Row | undefined {
  const found = heading.exec(lines[at] ?? "");
  if (found === null) {
    return undefined;
  }
  const next = lines.slice(at + 1).findIndex((line) => line.startsWith("## "));
  const section = next < 0 ? lines.slice(at + 1) : lines.slice(at + 1, at + 1 + next);
  const held = section.map((line) => heldByLine.exec(line.trim())).find((match) => match !== null);
  return { id: found[1] ?? "", says: (found[2] ?? "").trim(), heldBy: held?.[1] ?? "" };
}

function isHeldBy(heldBy: string, holders: readonly string[]): boolean {
  const parts = heldBy
    .replace(/\([^()]*\)/g, "")
    .split(/[;,]/)
    .map((part) => part.trim().toLowerCase());
  return parts.some((part) => holders.some((words) => part.startsWith(words)));
}

function practicesHeldBy(text: string, holders: readonly string[]): readonly Practice[] {
  const lines = text.split("\n");
  const rows = lines.map((line, at) => tableRow(line) ?? headedRow(lines, at));
  return rows
    .filter((row) => row !== undefined)
    .filter((row) => isHeldBy(row.heldBy, holders))
    .map((row) => ({ id: row.id, says: row.says }));
}

export function reviewersPractices(text: string): readonly Practice[] {
  return practicesHeldBy(text, reviewersWords);
}

export function designPractices(text: string): readonly Practice[] {
  return practicesHeldBy(text, designWords);
}
