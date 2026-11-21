const firstLetter = "a".charCodeAt(0);

export function letterAt(index: number): string {
  return String.fromCharCode(firstLetter + index);
}

function indexOfLetter(letter: string): number {
  return letter.length === 1 ? letter.charCodeAt(0) - firstLetter : -1;
}

export function lettersOf(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => letterAt(index));
}

export function namesChoice(letter: string, count: number): boolean {
  const index = indexOfLetter(letter);
  return index >= 0 && index < count;
}

export function choiceAt(choices: readonly string[], letter: string): string | undefined {
  return namesChoice(letter, choices.length) ? choices[indexOfLetter(letter)] : undefined;
}

export function repeated(items: readonly string[]): readonly string[] {
  return [...new Set(items.filter((item, index) => items.indexOf(item) !== index))];
}

export function joined(names: readonly string[]): string {
  if (names.length < 2) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function spaced(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function wordCount(text: string): number {
  const words = spaced(text);
  return words === "" ? 0 : words.split(" ").length;
}

export function holds(text: string, words: string): boolean {
  const wanted = spaced(words);
  return wanted !== "" && spaced(text).includes(wanted);
}

export function each(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${each(count, one, many)}`;
}
