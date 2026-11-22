import { failedEntries, summaryOf, type FailedEntry, type ReportedText } from "./tap.ts";

type FailingCase = {
  readonly name: string;
  readonly file: string;
  readonly message: string;
  readonly charactersCut: number;
};

type Printed = {
  readonly stdout: string;
  readonly stdoutCut: boolean;
};

type Cases = {
  readonly failures: readonly FailingCase[];
  readonly failuresNotListed: number;
  readonly notLoaded: readonly string[];
};

const mostFailures = 50;

const longestMessage = 200;

const lineBreak = /\r\n|\r|\n/;

const lineAndColumn = /:\d+:\d+$/;

const failedOnlyByItsCases = "subtestsFailed";

function isWholeFile(entry: FailedEntry): boolean {
  return entry.fields.has("exitCode");
}

function fileOf(entry: FailedEntry, folder: string): string {
  const location = entry.fields.get("location")?.text.replace(lineAndColumn, "") ?? "";
  const inside = `${folder}/`;
  return folder !== "" && location.startsWith(inside) ? location.slice(inside.length) : location;
}

function messageOf(error: ReportedText | undefined): Pick<FailingCase, "message" | "charactersCut"> {
  const lines = (error?.text ?? "").split(lineBreak).map((line) => line.trim());
  const index = lines.findIndex((line) => line !== "");
  const characters = Array.from(lines[index] ?? "");
  const notShown = index === lines.length - 1 ? (error?.charactersNotShown ?? 0) : 0;
  return {
    message: characters.slice(0, longestMessage).join(""),
    charactersCut: Math.max(0, characters.length - longestMessage) + notShown,
  };
}

function caseOf(entry: FailedEntry, folder: string): FailingCase {
  return { name: entry.name, file: fileOf(entry, folder), ...messageOf(entry.fields.get("error")) };
}

function unshownFailures(printed: Printed, entries: readonly FailedEntry[]): number {
  const counted = printed.stdoutCut ? (summaryOf(printed.stdout)?.fail ?? 0) : 0;
  return Math.max(0, counted - entries.length);
}

export function casesOf(printed: Printed, folder: string): Cases {
  const entries = failedEntries(printed.stdout);
  const notLoaded = entries.filter(isWholeFile).map((entry) => fileOf(entry, folder) || entry.name);
  const cases = entries
    .filter((entry) => !isWholeFile(entry))
    .filter((entry) => entry.fields.get("failureType")?.text !== failedOnlyByItsCases)
    .map((entry) => caseOf(entry, folder));
  return {
    failures: cases.slice(0, mostFailures),
    failuresNotListed: Math.max(0, cases.length - mostFailures) + unshownFailures(printed, entries),
    notLoaded: [...new Set(notLoaded)],
  };
}
