const choiceLetters = "abc";

export function joined(names: readonly string[]): string {
  if (names.length < 2) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

export function letterAt(index: number): string {
  return choiceLetters.charAt(index);
}

export function indexOfLetter(letter: string): number {
  return letter.length === 1 ? choiceLetters.indexOf(letter) : -1;
}

export function lettersOf(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => letterAt(index));
}

function spaced(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function holds(text: string, words: string): boolean {
  const wanted = spaced(words);
  return wanted !== "" && spaced(text).includes(wanted);
}

export function each(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
