export const readKeywords: readonly string[] = ["select", "with", "values"];

export const writeKeywords: readonly string[] = ["insert", "replace", "update", "delete", "create", "drop", "alter"];

function skipLineComment(sql: string, start: number): number {
  const end = sql.indexOf("\n", start);
  return end < 0 ? sql.length : end + 1;
}

function skipBlockComment(sql: string, start: number): number {
  const end = sql.indexOf("*/", start + 2);
  return end < 0 ? sql.length : end + 2;
}

function skipSpaceAndComments(sql: string, start: number): number {
  let position = start;
  while (position < sql.length) {
    if (/\s/.test(sql.charAt(position))) {
      position += 1;
    } else if (sql.startsWith("--", position)) {
      position = skipLineComment(sql, position);
    } else if (sql.startsWith("/*", position)) {
      position = skipBlockComment(sql, position);
    } else {
      return position;
    }
  }
  return position;
}

export function leadingKeyword(sql: string): string {
  const start = skipSpaceAndComments(sql, 0);
  const match = /^[A-Za-z_]+/.exec(sql.slice(start));
  return match === null ? "" : match[0].toLowerCase();
}

export function isOneStatement(sql: string, firstStatement: string): boolean {
  return sql.startsWith(firstStatement) && skipSpaceAndComments(sql, firstStatement.length) === sql.length;
}

const quoteEnds: Readonly<Record<string, string>> = { "'": "'", '"': '"', "`": "`", "[": "]" };

function skipQuoted(sql: string, start: number): number {
  const end = quoteEnds[sql.charAt(start)] ?? "";
  let position = start + 1;
  while (position < sql.length) {
    if (sql.charAt(position) !== end) {
      position += 1;
    } else if (end !== "]" && sql.charAt(position + 1) === end) {
      position += 2;
    } else {
      return position + 1;
    }
  }
  return position;
}

export function statementWords(sql: string): readonly string[] {
  const words: string[] = [];
  let position = skipSpaceAndComments(sql, 0);
  while (position < sql.length) {
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(position))?.[0];
    if (word !== undefined) {
      words.push(word.toLowerCase());
      position += word.length;
    } else if (Object.hasOwn(quoteEnds, sql.charAt(position))) {
      position = skipQuoted(sql, position);
    } else {
      position += 1;
    }
    position = skipSpaceAndComments(sql, position);
  }
  return words;
}
