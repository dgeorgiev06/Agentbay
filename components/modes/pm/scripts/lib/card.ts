export type CardLine =
  | { readonly mark: "computed"; readonly words: string; readonly source: { readonly step: string } }
  | { readonly mark: "judged"; readonly words: string; readonly source: { readonly step: string } };

export type Card = {
  readonly title: string;
  readonly lines: readonly CardLine[];
  readonly withheld: Readonly<Record<string, string>>;
};

export function computedBy(step: string): (words: string) => CardLine {
  return (words) => ({ mark: "computed", words, source: { step } });
}

export function judgedBy(step: string): (words: string) => CardLine {
  return (words) => ({ mark: "judged", words, source: { step } });
}
