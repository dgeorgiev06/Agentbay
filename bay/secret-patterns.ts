type SecretPattern = {
  readonly kind: string;
  readonly pattern: RegExp;
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

const patternsMostSpecificFirst: readonly SecretPattern[] = [
  {
    kind: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: "bearer", pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { kind: "api-key", pattern: new RegExp(`\\b(?:${apiKeyShapes.join("|")})`, "g") },
  { kind: "connection-string", pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@'"]+:[^\s@/'"]+@[^\s'"]+/gi },
  { kind: "password", pattern: /\b(?:password|passwd|pwd)\s*[=:]\s*(?:"[^"]*"|'[^']*'|\S+)/gi },
  {
    kind: "secret-assignment",
    pattern: new RegExp(`\\b(?:${secretNames.join("|")})\\s*[=:]\\s*["']?[A-Za-z0-9/+_.=-]{12,}`, "gi"),
  },
];

export function scrubSecretPatterns(text: string): string {
  let scrubbed = text;
  for (const { kind, pattern } of patternsMostSpecificFirst) {
    scrubbed = scrubbed.replace(pattern, `[redacted:${kind}]`);
  }
  return scrubbed;
}
