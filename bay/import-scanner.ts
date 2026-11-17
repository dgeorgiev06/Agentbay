export type Binds = "values" | "types" | "nothing";

export type ImportSpecifier =
  | { readonly kind: "literal"; readonly text: string; readonly line: number; readonly binds: Binds }
  | { readonly kind: "computed"; readonly line: number };

type Token = {
  readonly kind: "word" | "value" | "string" | "punct";
  readonly text: string;
  readonly start: number;
};

type Lexed = {
  readonly tokens: readonly Token[];
  readonly end: number;
};

type Tokens = {
  readonly tokens: readonly Token[];
  readonly source: string;
};

const wordPart = /[A-Za-z0-9_$]/;

const expressionEnds: readonly string[] = [")", "]", "}"];

const wordsBeforeRegex: readonly string[] = ["return", "typeof", "instanceof", "in", "of", "new", "delete", "void"];

const moreWordsBeforeRegex: readonly string[] = ["throw", "case", "do", "else", "yield", "await"];

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function regexMayStart(previous: Token | undefined): boolean {
  if (previous?.kind === "word") {
    return wordsBeforeRegex.includes(previous.text) || moreWordsBeforeRegex.includes(previous.text);
  }
  return previous === undefined || (previous.kind === "punct" && !expressionEnds.includes(previous.text));
}

function endWhile(source: string, start: number, pattern: RegExp): number {
  let position = start;
  while (position < source.length && pattern.test(source.charAt(position))) {
    position += 1;
  }
  return position;
}

function endOfQuoted(source: string, start: number): number {
  const quote = source.charAt(start);
  let position = start + 1;
  while (position < source.length && source.charAt(position) !== quote && source.charAt(position) !== "\n") {
    position += source.charAt(position) === "\\" ? 2 : 1;
  }
  return Math.min(position + 1, source.length);
}

function endOfRegex(source: string, start: number): number {
  let position = start + 1;
  let inClass = false;
  while (position < source.length && source.charAt(position) !== "\n") {
    const character = source.charAt(position);
    if (character === "/" && !inClass) {
      return endWhile(source, position + 1, wordPart);
    }
    if (character === "[" || character === "]") {
      inClass = character === "[";
    }
    position += character === "\\" ? 2 : 1;
  }
  return position;
}

function endOfSpaceAndComments(source: string, start: number): number {
  let position = endWhile(source, start, /\s/);
  while (source.startsWith("//", position) || source.startsWith("/*", position)) {
    const isLine = source.startsWith("//", position);
    const close = isLine ? source.indexOf("\n", position) : source.indexOf("*/", position + 2);
    const after = close < 0 ? source.length : close + (isLine ? 1 : 2);
    position = endWhile(source, after, /\s/);
  }
  return position;
}

function lexTemplate(source: string, start: number): Lexed {
  const tokens: Token[] = [];
  let position = start + 1;
  while (position < source.length && source.charAt(position) !== "`") {
    if (source.startsWith("${", position)) {
      const inner = lexCode(source, position + 2, true);
      tokens.push(...inner.tokens, { kind: "punct", text: ";", start: inner.end });
      position = inner.end + 1;
    } else {
      position += source.charAt(position) === "\\" ? 2 : 1;
    }
  }
  const end = Math.min(position + 1, source.length);
  const plain = !source.slice(start, end).includes("${");
  const whole: Token = { kind: plain ? "string" : "value", text: source.slice(start + 1, end - 1), start };
  return { tokens: [...tokens, whole], end };
}

function tokenAt(source: string, start: number, previous: Token | undefined): Lexed {
  const character = source.charAt(start);
  if (wordPart.test(character)) {
    const end = endWhile(source, start, wordPart);
    const kind = /[0-9]/.test(character) ? "value" : "word";
    return { tokens: [{ kind, text: source.slice(start, end), start }], end };
  }
  if (character === '"' || character === "'") {
    const end = endOfQuoted(source, start);
    return { tokens: [{ kind: "string", text: source.slice(start + 1, end - 1), start }], end };
  }
  if (character === "`") {
    return lexTemplate(source, start);
  }
  if (character === "/" && regexMayStart(previous)) {
    return { tokens: [{ kind: "value", text: "", start }], end: endOfRegex(source, start) };
  }
  return { tokens: [{ kind: "punct", text: character, start }], end: start + 1 };
}

function lexCode(source: string, start: number, insideTemplate: boolean): Lexed {
  const tokens: Token[] = [];
  let depth = 0;
  let position = endOfSpaceAndComments(source, start);
  while (position < source.length && !(insideTemplate && depth === 0 && source.charAt(position) === "}")) {
    const next = tokenAt(source, position, tokens.at(-1));
    const text = next.tokens.length === 1 ? next.tokens[0]?.text : undefined;
    depth += text === "{" ? 1 : 0;
    depth -= text === "}" ? 1 : 0;
    tokens.push(...next.tokens);
    position = endOfSpaceAndComments(source, next.end);
  }
  return { tokens, end: position };
}

type Named = { readonly token: Token | undefined; readonly binds: Binds };

function literalAt(at: Tokens, keyword: Token, named: Named): ImportSpecifier | undefined {
  const { token, binds } = named;
  return token?.kind === "string"
    ? { kind: "literal", text: token.text, line: lineAt(at.source, keyword.start), binds }
    : undefined;
}

function callAt(at: Tokens, index: number): ImportSpecifier | undefined {
  const [keyword, open, argument, close] = at.tokens.slice(index, index + 4);
  if (keyword === undefined || open?.text !== "(") {
    return undefined;
  }
  const line = lineAt(at.source, keyword.start);
  if (argument?.kind === "string" && (close?.text === ")" || close?.text === ",")) {
    return { kind: "literal", text: argument.text, line, binds: "values" };
  }
  return { kind: "computed", line };
}

function fromAt(at: Tokens, index: number): number | undefined {
  let depth = 0;
  for (const [offset, token] of at.tokens.slice(index).entries()) {
    depth += token.text === "{" ? 1 : 0;
    depth -= token.text === "}" ? 1 : 0;
    if (depth === 0 && token.kind === "word" && token.text === "from") {
      return index + offset;
    }
    if (depth === 0 && [";", "=", "import", "export"].includes(token.text)) {
      return undefined;
    }
  }
  return undefined;
}

function namesBetweenBraces(clause: readonly Token[]): readonly (readonly Token[])[] {
  const open = clause.findIndex((token) => token.text === "{");
  const close = clause.findIndex((token) => token.text === "}");
  if (open < 0) {
    return [];
  }
  const names: Token[][] = [[]];
  for (const token of clause.slice(open + 1, close < 0 ? undefined : close)) {
    if (token.text === ",") {
      names.push([]);
    } else {
      names.at(-1)?.push(token);
    }
  }
  return names.filter((name) => name.length > 0);
}

function isMarkedType(name: readonly Token[]): boolean {
  return name[0]?.text === "type" && name.length > 1 && name[1]?.text !== "as";
}

function bindsOf(clause: readonly Token[]): Binds {
  const [first, second] = clause;
  if (first?.text === "type" && second !== undefined && second.text !== ",") {
    return "types";
  }
  const open = clause.findIndex((token) => token.text === "{");
  const beforeBraces = open < 0 ? clause : clause.slice(0, open);
  const names = namesBetweenBraces(clause);
  if (beforeBraces.some((token) => token.text !== ",") || names.some((name) => !isMarkedType(name))) {
    return "values";
  }
  return names.length > 0 ? "types" : "nothing";
}

function importAt(at: Tokens, index: number, keyword: Token): ImportSpecifier | undefined {
  const next = at.tokens[index + 1];
  if (next?.text === "(") {
    return callAt(at, index);
  }
  if (next === undefined || next.text === ".") {
    return undefined;
  }
  if (next.kind === "string") {
    return literalAt(at, keyword, { token: next, binds: "nothing" });
  }
  const from = fromAt(at, index + 1);
  const clause = at.tokens.slice(index + 1, from);
  return from === undefined
    ? undefined
    : literalAt(at, keyword, { token: at.tokens[from + 1], binds: bindsOf(clause) });
}

function exportAt(at: Tokens, index: number, keyword: Token): ImportSpecifier | undefined {
  const first = at.tokens[index + 1]?.text === "type" ? index + 2 : index + 1;
  const opening = at.tokens[first]?.text;
  const from = opening === "*" || opening === "{" ? fromAt(at, first) : undefined;
  return from === undefined ? undefined : literalAt(at, keyword, { token: at.tokens[from + 1], binds: "nothing" });
}

type Recognizer = (at: Tokens, index: number, keyword: Token) => ImportSpecifier | undefined;

const recognizers: Readonly<Record<string, Recognizer>> = { import: importAt, export: exportAt, require: callAt };

function specifierAt(at: Tokens, index: number): ImportSpecifier | undefined {
  const token = at.tokens[index];
  if (token?.kind !== "word" || at.tokens[index - 1]?.text === "." || !Object.hasOwn(recognizers, token.text)) {
    return undefined;
  }
  return recognizers[token.text]?.(at, index, token);
}

export function importSpecifiers(source: string): readonly ImportSpecifier[] {
  const at = { tokens: lexCode(source, 0, false).tokens, source };
  return at.tokens.flatMap((_token, index) => specifierAt(at, index) ?? []);
}
