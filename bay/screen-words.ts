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

function bare(text: string): string {
  return text.trim().toLowerCase().replace(/[.:]$/, "");
}

export function kernelPhraseIn(words: string): string | undefined {
  const said = bare(words);
  const opening = Object.values(kernelWords).find((phrase) => said.startsWith(bare(phrase)));
  if (opening !== undefined) {
    return opening;
  }
  const heading = Object.values(headings).find((each) => said === bare(each));
  if (heading !== undefined) {
    return heading;
  }
  return [moreLeft, reportedBy].map((pattern) => pattern.exec(words.trim())?.[0]).find((found) => found !== undefined);
}

export function isPlainTitle(title: string): boolean {
  return plainTitle.test(title);
}
