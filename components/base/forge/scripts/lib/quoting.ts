const quotedLength = 20;

function runsOf(text: string): readonly string[] {
  const characters = Array.from(text);
  const starts = Math.max(0, characters.length - quotedLength + 1);
  return Array.from({ length: starts }, (_, start) => characters.slice(start, start + quotedLength).join(""));
}

export function quotesAny(text: string, tests: readonly string[]): boolean {
  return runsOf(text).some((run) => tests.some((test) => test.includes(run)));
}

export function mayQuoteAny(text: string, tests: readonly string[]): boolean {
  return tests.length === 0 ? text.trim() !== "" : quotesAny(text, tests);
}

export function quotesAnyBeyond(text: string, tests: readonly string[], given: readonly string[]): boolean {
  return runsOf(text).some(
    (run) => tests.some((test) => test.includes(run)) && !given.some((said) => said.includes(run)),
  );
}
