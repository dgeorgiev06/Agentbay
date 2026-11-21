import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";

const markBytes = 16;

const markLine = /^\/\/ ([0-9a-f]{32})\n/;

export async function newMark(context: Pick<ScriptContext, "random">): Promise<string> {
  const drawn = await context.random(markBytes);
  return drawn.ok ? drawn.value : fail(`No mark could be drawn for the tests: ${drawn.message}`);
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
