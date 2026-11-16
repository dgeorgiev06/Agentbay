export type Summary = {
  readonly tests: number;
  readonly pass: number;
  readonly fail: number;
  readonly cancelled: number;
};

const countLine = /^# (tests|pass|fail|cancelled) (\d+)$/gm;

const failedLine = /^\s*not ok \d+ - (.*)$/gm;

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

export function failedTestNames(output: string): readonly string[] {
  return [...output.matchAll(failedLine)]
    .map(([, name = ""]) => name)
    .filter((name) => !directive.test(name))
    .map(unescaped);
}
