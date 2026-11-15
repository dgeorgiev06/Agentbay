type SecretPattern = {
  readonly kind: string;
  readonly pattern: RegExp;
  readonly shortestValue?: number;
};

const apiKeyShapes = [
  "sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}",
  "AKIA[0-9A-Z]{16}",
  "ASIA[0-9A-Z]{16}",
  "gh[pousr]_[A-Za-z0-9]{30,}",
  "github_pat_[A-Za-z0-9_]{30,}",
  "xox[abprs]-[A-Za-z0-9-]{10,}",
  "AIza[0-9A-Za-z_-]{35}",
  "glpat-[A-Za-z0-9_-]{20,}",
];

const secretNames = [
  "api[_-]?key",
  "secret",
  "access[_-]?token",
  "refresh[_-]?token",
  "client[_-]?secret",
  "aws_secret_access_key",
];

const assignedValue = `\\s*[=:]\\s*(?<value>"[^"]*"|'[^']*'|[^\\s"']+)`;

const patternsMostSpecificFirst: readonly SecretPattern[] = [
  {
    kind: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: "bearer", pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { kind: "api-key", pattern: new RegExp(`\\b(?:${apiKeyShapes.join("|")})`, "g") },
  { kind: "connection-string", pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@'"]+:[^\s@/'"]+@[^\s'"]+/gi },
  { kind: "password", pattern: new RegExp(`\\b(?:password|passwd|pwd)${assignedValue}`, "gi"), shortestValue: 8 },
  {
    kind: "secret-assignment",
    pattern: new RegExp(`\\b(?:${secretNames.join("|")})${assignedValue}`, "gi"),
    shortestValue: 12,
  },
];

const characterClasses: readonly RegExp[] = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9/\s]/];

function unquoted(value: string): string {
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return quoted && value.length >= 2 ? value.slice(1, -1) : value;
}

function looksLikeSecretValue(value: string, shortestValue: number): boolean {
  const bare = unquoted(value);
  const classes = characterClasses.filter((characterClass) => characterClass.test(bare)).length;
  return bare.length >= shortestValue && classes >= 2;
}

function scrubbedBy(text: string, secretPattern: SecretPattern): string {
  const marker = `[redacted:${secretPattern.kind}]`;
  const shortestValue = secretPattern.shortestValue;
  if (shortestValue === undefined) {
    return text.replace(secretPattern.pattern, marker);
  }
  return text.replace(secretPattern.pattern, (match: string, ...rest: unknown[]) => {
    const groups = rest.at(-1);
    const value: unknown = typeof groups === "object" && groups !== null ? Reflect.get(groups, "value") : undefined;
    return typeof value === "string" && looksLikeSecretValue(value, shortestValue) ? marker : match;
  });
}

export function scrubSecretPatterns(text: string): string {
  let scrubbed = text;
  for (const secretPattern of patternsMostSpecificFirst) {
    scrubbed = scrubbedBy(scrubbed, secretPattern);
  }
  return scrubbed;
}
