import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { jsonOf, textAt } from "./kit-copy.ts";

export type Part = {
  readonly given: Json;
  readonly until?: string;
};

export type PartStart = {
  readonly trigger: Json;
  readonly part: Part;
};

const shortCommitDigits = 7;

function startPartRan(root: string, words: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/start-part.ts", ...words], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

export async function partStarted(root: string, workflow: string, start: PartStart): Promise<string> {
  const words = [workflow, JSON.stringify(start.trigger), JSON.stringify(start.part)];
  const answer = jsonOf(await startPartRan(root, words));
  if (fieldsOf(answer).ok !== true) {
    throw new Error(`The part of ${workflow} did not start: ${JSON.stringify(answer)}`);
  }
  return textAt(fieldsOf(answer).run ?? null, "id");
}

export async function givenIn(file: string): Promise<Json> {
  return jsonOf(await readFile(join(import.meta.dirname, file), "utf8"));
}

export function withCommits(given: Json, commits: ReadonlyMap<string, string>): Json {
  let text = JSON.stringify(given);
  for (const [captured, made] of commits) {
    text = text
      .replaceAll(captured, made)
      .replaceAll(captured.slice(0, shortCommitDigits), made.slice(0, shortCommitDigits));
  }
  return jsonOf(text);
}
