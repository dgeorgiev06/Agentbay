import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { listOf, textOf } from "./json-values.ts";

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

const plannedWords = ["planned check", "check planned"];

const reviewersWords = ["review", ...plannedWords];

const checkWords = ["check", "compiler", "the compiler", "linter", "the feature map", "dead-code check"];

const designWords = ["design"];

const planWords = ["plan"];

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
  const startsWith = (part: string, words: string): boolean =>
    part === words || part.startsWith(`${words} `) || part.startsWith(`${words}:`);
  return parts.some((part) => holders.some((words) => startsWith(part, words)));
}

function rowsOf(text: string): readonly Row[] {
  const lines = text.split("\n");
  return lines.map((line, at) => tableRow(line) ?? headedRow(lines, at)).filter((row) => row !== undefined);
}

function practicesHeldBy(text: string, holders: readonly string[]): readonly Practice[] {
  return rowsOf(text)
    .filter((row) => isHeldBy(row.heldBy, holders))
    .map((row) => ({ id: row.id, says: row.says }));
}

export function reviewersPractices(text: string): readonly Practice[] {
  return practicesHeldBy(text, reviewersWords);
}

export function checksPractices(text: string): readonly Practice[] {
  const reviewers = reviewersPractices(text).map((practice) => practice.id);
  return practicesHeldBy(text, checkWords).filter((practice) => !reviewers.includes(practice.id));
}

export function designPractices(text: string): readonly Practice[] {
  return practicesHeldBy(text, designWords);
}

export function planPractices(text: string): readonly Practice[] {
  return practicesHeldBy(text, planWords);
}

export function practicesOf(value: Json | undefined): readonly Practice[] {
  return listOf(value).map((entry) => {
    const fields = fieldsOf(entry);
    return { id: textOf(fields.id), says: textOf(fields.says) };
  });
}
