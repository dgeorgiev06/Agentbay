export type Summary = {
  readonly tests: number;
  readonly pass: number;
  readonly fail: number;
  readonly cancelled: number;
};

const countLine = /^# (tests|pass|fail|cancelled) (\d+)$/gm;

const directive = /(?<!\\) # (?:TODO|SKIP)\b/i;

function lastCounts(output: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const [, name = "", count = ""] of output.matchAll(countLine)) {
    counts.set(name, Number(count));
  }
  return counts;
}

export function summaryOf(output: string): Summary | undefined {
  const counts = lastCounts(output);
  const tests = counts.get("tests");
  const pass = counts.get("pass");
  const fail = counts.get("fail");
  const cancelled = counts.get("cancelled");
  if (tests === undefined || pass === undefined || fail === undefined || cancelled === undefined) {
    return undefined;
  }
  return { tests, pass, fail, cancelled };
}

function unescaped(name: string): string {
  return name.replace(/\\([\\#])/g, "$1");
}

export type ReportedText = {
  readonly text: string;
  readonly charactersNotShown: number;
};

export type FailedEntry = {
  readonly name: string;
  readonly fields: ReadonlyMap<string, ReportedText>;
};

const failedEntryLine = /^(\s*)not ok \d+ - (.*)$/;

const fieldLine = /^([A-Za-z_]+):(.*)$/;

const notShownTail = /^\.\.\. (\d+) more characters?$/;

const escapes: Readonly<Record<string, string>> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };

const escapedCharacter = /\\(x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)/g;

function unescapedCharacter(escaped: string): string {
  if (escaped.startsWith("x") || escaped.startsWith("u")) {
    return String.fromCodePoint(parseInt(escaped.replace(/^[xu]\{?|\}$/g, ""), 16));
  }
  return escapes[escaped] ?? escaped;
}

function quotedEnd(value: string): number {
  const quote = value[0];
  let index = 1;
  while (index < value.length && value[index] !== quote) {
    index += value[index] === "\\" ? 2 : 1;
  }
  return index;
}

function quotedText(value: string): ReportedText {
  const end = quotedEnd(value);
  const text = value.slice(1, end).replace(escapedCharacter, (_, escaped: string) => unescapedCharacter(escaped));
  const notShown = notShownTail.exec(value.slice(end + 1));
  return { text, charactersNotShown: notShown === null ? 0 : Number(notShown[1]) };
}

function reportedText(value: string, continued: readonly string[]): ReportedText {
  if (value === "|-" || value === "|") {
    return { text: continued.join("\n"), charactersNotShown: 0 };
  }
  if (["'", '"', "`"].includes(value[0] ?? "")) {
    return quotedText(value);
  }
  return { text: value, charactersNotShown: 0 };
}

function blockLines(lines: readonly string[], fieldIndent: string): readonly string[] {
  if (lines[0] !== `${fieldIndent}---`) {
    return [];
  }
  const end = lines.indexOf(`${fieldIndent}...`);
  return end === -1 ? [] : lines.slice(1, end);
}

function fieldsOf(block: readonly string[], fieldIndent: string): ReadonlyMap<string, ReportedText> {
  const continuedIndent = `${fieldIndent}  `;
  const starts = block.flatMap((line, index) => {
    const field = line.startsWith(fieldIndent) ? fieldLine.exec(line.slice(fieldIndent.length)) : null;
    return field === null ? [] : [{ index, name: field[1] ?? "", value: (field[2] ?? "").trim() }];
  });
  return new Map(
    starts.map((start, position) => {
      const end = starts[position + 1]?.index ?? block.length;
      const continued = block.slice(start.index + 1, end).map((line) => line.slice(continuedIndent.length));
      return [start.name, reportedText(start.value, continued)];
    }),
  );
}

export function failedEntries(output: string): readonly FailedEntry[] {
  const lines = output.split("\n");
  return lines.flatMap((line, index) => {
    const entry = failedEntryLine.exec(line);
    const name = entry?.[2] ?? "";
    if (entry === null || directive.test(name)) {
      return [];
    }
    const fieldIndent = `${entry[1] ?? ""}  `;
    const block = blockLines(lines.slice(index + 1), fieldIndent);
    return [{ name: unescaped(name), fields: fieldsOf(block, fieldIndent) }];
  });
}

export function failedTestNames(output: string): readonly string[] {
  return failedEntries(output).map((entry) => entry.name);
}
