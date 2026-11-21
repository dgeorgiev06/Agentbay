import { fail, fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";

export type KindName =
  | "checks"
  | "fails-first"
  | "in-scope"
  | "as-declared"
  | "bugs-caught"
  | "same-output"
  | "count"
  | "real-thing"
  | "printed";

export type Count =
  | { readonly of: "most"; readonly pattern: string; readonly paths: readonly string[]; readonly most: number }
  | { readonly of: "no rise"; readonly pattern: string; readonly paths: readonly string[] }
  | { readonly of: "declared"; readonly name: string };

export type Command =
  | { readonly through: "bay"; readonly words: readonly string[] }
  | { readonly through: "toolchain"; readonly name: string; readonly arguments: readonly string[] };

export type RealRun = { readonly command: Command; readonly stdout: string; readonly exitCode: number };

export type Proof =
  | { readonly kind: "checks" }
  | { readonly kind: "fails-first"; readonly tests: readonly string[] }
  | { readonly kind: "in-scope" }
  | { readonly kind: "as-declared" }
  | { readonly kind: "bugs-caught" }
  | { readonly kind: "same-output"; readonly differ: readonly string[] }
  | { readonly kind: "count"; readonly count: Count }
  | { readonly kind: "real-thing"; readonly runs: readonly RealRun[] }
  | { readonly kind: "printed"; readonly runs: readonly Command[] };

type Proofs = { readonly [Each in Proof as Each["kind"]]: Each };

export type ProofOf<Kind extends KindName> = Proofs[Kind];

export type ProvenItem = { readonly id: string; readonly proof: Proof };

export type JudgementItem = { readonly id: string; readonly says: string; readonly level: "must" | "should" };

export type Names = {
  readonly gained: readonly string[];
  readonly lost: readonly string[];
  readonly changed: readonly string[];
};

export type Bug = { readonly name: string; readonly patch: string; readonly tests: readonly string[] };

export type DeclaredCommand = { readonly name: string; readonly command: Command };

export type DeclaredCount = { readonly name: string; readonly pattern: string; readonly paths: readonly string[] };

export type Request = {
  readonly base: string;
  readonly head: string;
  readonly scope: readonly string[];
  readonly proven: readonly ProvenItem[];
  readonly judgement: readonly JudgementItem[];
  readonly declared: { readonly files: readonly string[]; readonly names: Names };
  readonly bugs: readonly Bug[];
  readonly sameOutput: readonly DeclaredCommand[];
  readonly noRise: readonly DeclaredCount[];
};

function text(fields: JsonFields, name: string): string {
  const value = fields[name];
  return typeof value === "string" ? value : fail(`The request has no text ${name}.`);
}

function number(fields: JsonFields, name: string): number {
  const value = fields[name];
  return typeof value === "number" ? value : fail(`The request has no number ${name}.`);
}

function texts(fields: JsonFields, name: string): readonly string[] {
  const value = fields[name];
  return Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry : fail(`${name} holds a value that is not text.`)))
    : [];
}

function records(fields: JsonFields, name: string): readonly JsonFields[] {
  const value = fields[name];
  return Array.isArray(value) ? value.map(fieldsOf) : [];
}

function countOf(fields: JsonFields): Count {
  if (fields.use !== undefined) {
    return { of: "declared", name: text(fields, "use") };
  }
  const counted = { pattern: text(fields, "pattern"), paths: texts(fields, "paths") };
  return fields.noRise === true
    ? { of: "no rise", ...counted }
    : { of: "most", ...counted, most: number(fields, "most") };
}

function commandOf(fields: JsonFields): Command {
  if (fields.run === undefined) {
    return { through: "bay", words: texts(fields, "bay") };
  }
  return { through: "toolchain", name: text(fields, "run"), arguments: texts(fields, "arguments") };
}

function realRunOf(fields: JsonFields): RealRun {
  return { command: commandOf(fields), stdout: text(fields, "stdout"), exitCode: number(fields, "exitCode") };
}

function proofOf(fields: JsonFields): Proof {
  const kind = text(fields, "kind");
  switch (kind) {
    case "checks":
    case "bugs-caught":
      return { kind };
    case "fails-first":
      return { kind, tests: texts(fields, "tests") };
    case "same-output":
      return { kind, differ: texts(fields, "differ") };
    case "count":
      return { kind, count: countOf(fields) };
    case "real-thing":
      return { kind, runs: records(fields, "runs").map(realRunOf) };
    case "printed":
      return { kind, runs: records(fields, "runs").map(commandOf) };
    default:
      return fail(`The request names the kind ${kind}, which no item of a slice may name.`);
  }
}

function levelOf(fields: JsonFields): "must" | "should" {
  const level = text(fields, "level");
  return level === "must" || level === "should" ? level : fail(`The level ${level} is neither must nor should.`);
}

function judgementOf(fields: JsonFields): JudgementItem {
  return { id: text(fields, "id"), says: text(fields, "says"), level: levelOf(fields) };
}

function namesOf(fields: JsonFields): Names {
  return { gained: texts(fields, "gained"), lost: texts(fields, "lost"), changed: texts(fields, "changed") };
}

export function requestOf(input: Json, settings: Readonly<Record<string, Json>>): Request {
  const fields = fieldsOf(input);
  const slice = fieldsOf(fields.slice ?? null);
  const done = records(slice, "done");
  const declared = fieldsOf(fields.declared ?? null);
  return {
    base: text(fields, "base"),
    head: text(fields, "head"),
    scope: texts(slice, "scope"),
    proven: done.flatMap((item) =>
      item.proof === undefined ? [] : [{ id: text(item, "id"), proof: proofOf(fieldsOf(item.proof)) }],
    ),
    judgement: done.filter((item) => item.proof === undefined).map(judgementOf),
    declared: { files: texts(declared, "files"), names: namesOf(fieldsOf(declared.names ?? null)) },
    bugs: records(fields, "bugs").map((bug) => ({
      name: text(bug, "name"),
      patch: text(bug, "patch"),
      tests: texts(bug, "tests"),
    })),
    sameOutput: records(settings, "sameOutput").map((command) => ({
      name: text(command, "name"),
      command: commandOf(command),
    })),
    noRise: records(settings, "noRise").map((count) => ({
      name: text(count, "name"),
      pattern: text(count, "pattern"),
      paths: texts(count, "paths"),
    })),
  };
}
