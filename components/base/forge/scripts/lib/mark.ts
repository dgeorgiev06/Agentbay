import { randomBytes } from "node:crypto";

const markBytes = 16;

const markLine = /^\/\/ ([0-9a-f]{32})\n/;

export function newMark(): string {
  return randomBytes(markBytes).toString("hex");
}

export function marked(text: string, mark: string): string {
  return `// ${mark}\n${text}`;
}

export function markOf(text: string): string | undefined {
  return markLine.exec(text)?.[1];
}

export function withoutMark(text: string): string {
  return text.replace(markLine, "");
}
