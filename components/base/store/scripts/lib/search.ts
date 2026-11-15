const wordPattern = /[\p{L}\p{N}]+/gu;

export function searchWords(text: string): readonly string[] {
  return text.match(wordPattern) ?? [];
}

export function searchExpression(words: readonly string[]): string {
  return words.map((word) => `"${word}"`).join(" ");
}
