export type ComputedBy = "slice" | "start" | "prove" | "draw" | "wave";

export type CardLine =
  | {
      readonly mark: "computed";
      readonly words: string;
      readonly source: { readonly step: ComputedBy };
    }
  | {
      readonly mark: "judged";
      readonly words: string;
      readonly source: { readonly step: string; readonly item?: number };
    };

export type Card = {
  readonly title: string;
  readonly lines: readonly CardLine[];
};

const cardWidth = 44;

const computedRoom = cardWidth - "    ".length;

const judgedRoom = cardWidth - "judged     ".length;

const longestShown = 120;

const unsafe = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export function shortened(text: string, longest: number): string {
  const words = text
    .replace(unsafe, " ")
    .split(" ")
    .filter((word) => word !== "")
    .join(" ");
  const characters = Array.from(words);
  return characters.length <= longest ? words : `${characters.slice(0, longest).join("")}...`;
}

export function safeText(text: string): string {
  return shortened(text, longestShown);
}

const shortCommitDigits = 7;

export function shortCommit(commit: string): string {
  return commit.slice(0, shortCommitDigits);
}

export function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

export function grouped(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+$)/g, ",");
}

export function quoted(names: readonly string[]): string {
  return names.map((name) => `"${name}"`).join(" and ");
}

export function twice(names: readonly string[]): readonly string[] {
  return [...new Set(names.filter((name, at) => names.indexOf(name) !== at))];
}

export function joined(names: readonly string[]): string {
  if (names.length < 2) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function piecesOf(word: string, room: number): readonly string[] {
  const pieces: string[] = [];
  let left = Array.from(word);
  while (left.length > room) {
    const slash = left.lastIndexOf("/", room - 1);
    const cut = slash > 0 ? slash + 1 : room;
    pieces.push(left.slice(0, cut).join(""));
    left = left.slice(cut);
  }
  return [...pieces, left.join("")];
}

function fitted(text: string, room: number): string {
  return text
    .replace(unsafe, " ")
    .split(" ")
    .filter((word) => word !== "")
    .flatMap((word) => piecesOf(word, room))
    .join(" ");
}

export function computed(step: ComputedBy, words: string): CardLine {
  return { mark: "computed", words: fitted(words, computedRoom), source: { step } };
}

export function judged(step: string, words: string): CardLine {
  return { mark: "judged", words: fitted(words, judgedRoom), source: { step } };
}

export function inItem(item: number, lines: readonly CardLine[]): readonly CardLine[] {
  return lines.map((line) => (line.mark === "judged" ? { ...line, source: { step: line.source.step, item } } : line));
}
