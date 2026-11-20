const longestSentence = 200;

export const notQuoting = "say it in your own words; the builder never reads a line of a test.";

export function isOneSentence(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed !== "" &&
    Array.from(text).length <= longestSentence &&
    !/[\r\n]/.test(text) &&
    !/[.!?]["')\]]*\s+\S/.test(trimmed)
  );
}
