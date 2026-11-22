export const sections = ["problems", "what", "checks", "open"] as const;

export type Section = (typeof sections)[number];

export const headings: Readonly<Record<Section, string>> = {
  problems: "Problems",
  what: "What it is",
  checks: "Checks",
  open: "Not decided",
};

export const kernelWords = {
  modelWrote: "A model wrote",
  scriptWorked: "A script worked this out",
  toolRan: "A tool ran",
  reported: "reported:",
  cannotReply: "You cannot reply",
  why: "Why:",
  eachReply: "What each reply does",
  reply: "Reply:",
  details: "Details:",
  contents: "In this view",
  oneSection: "One section alone:",
  wholeView: "The whole view:",
  everyFact: "Every fact this approval rests on.",
  sectionOfDetails: "One section of the details.",
  noFacts: "It has no facts.",
  record: "For the record",
  copying: "These lines are for copying, so they are not wrapped.",
  producedBy: "Who produced the facts:",
  steps: "The steps of this run:",
  fullHash: "The full hash:",
  decide: "Decide with:",
} as const;

export const longestTitle = 200;

export const longestWords = 600;

export const longestAbout = 80;

const plainTitle = /^[\x20-\x7e]+$/;

const reportedBy = /^\S+ reported:/i;

const moreLeft = /^and \d+ more\b/i;

export function moreWords(count: number): string {
  return `and ${String(count)} more, see details`;
}

function lowered(text: string): string {
  return text.trim().toLowerCase();
}

function opensWith(said: string, phrase: string): boolean {
  const opening = lowered(phrase).replace(/\.$/, "");
  return said.startsWith(opening) && !/[\p{L}\p{N}]/u.test(said.charAt(opening.length));
}

function isHeading(said: string): boolean {
  return Object.values(headings).some((heading) => said.replace(/[.:]$/, "") === lowered(heading));
}

export function kernelPhraseIn(words: string): string | undefined {
  const said = lowered(words);
  const opening = Object.values(kernelWords).find((phrase) => opensWith(said, phrase));
  if (opening !== undefined) {
    return opening;
  }
  if (isHeading(said)) {
    return words.trim();
  }
  const found = [moreLeft, reportedBy].map((pattern) => pattern.exec(words.trim())?.[0]);
  return found.find((each) => each !== undefined);
}

export function isPlainTitle(title: string): boolean {
  return plainTitle.test(title);
}
