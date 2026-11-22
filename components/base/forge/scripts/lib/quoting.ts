const quotedLength = 20;

function startsOf(characters: readonly string[]): readonly number[] {
  return Array.from({ length: Math.max(0, characters.length - quotedLength + 1) }, (_, start) => start);
}

function runAt(characters: readonly string[], start: number): string {
  return characters.slice(start, start + quotedLength).join("");
}

function runsOf(text: string): readonly string[] {
  const characters = Array.from(text);
  return startsOf(characters).map((start) => runAt(characters, start));
}

function quotedStarts(text: string, tests: readonly string[]): readonly number[] {
  const characters = Array.from(text);
  return startsOf(characters).filter((start) => tests.some((test) => test.includes(runAt(characters, start))));
}

export function quotedPlaces(spellings: readonly string[], tests: readonly string[]): ReadonlySet<number> {
  const starts = spellings.flatMap((spelling) => quotedStarts(spelling, tests));
  return new Set(starts.flatMap((start) => Array.from({ length: quotedLength }, (_, offset) => start + offset)));
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
