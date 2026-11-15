export type Problem = {
  readonly file: string;
  readonly path: string;
  readonly line?: number;
  readonly message: string;
  readonly fix?: string;
};

export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problems: readonly Problem[] };

export function succeededWith<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function failedWith(problems: readonly Problem[]): {
  readonly ok: false;
  readonly problems: readonly Problem[];
} {
  return { ok: false, problems };
}

export function unplacedProblem(message: string, fix?: string): Problem {
  return { file: "", path: "", message, ...(fix === undefined ? {} : { fix }) };
}

export function problemText(problems: readonly Problem[]): string {
  return problems.map((problem) => problem.message).join(" ");
}
