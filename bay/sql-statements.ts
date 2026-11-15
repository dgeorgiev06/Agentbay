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

export function skipSpaceAndComments(sql: string, start: number): number {
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
