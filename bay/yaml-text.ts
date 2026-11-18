import { createRequire } from "node:module";
import type * as Yaml from "yaml";
import type { Json } from "./contracts.ts";
import { isJson } from "./protocol-json.ts";

export type YamlPath = readonly (string | number)[];

export type YamlProblem = {
  readonly line: number;
  readonly message: string;
  readonly fix: string;
};

export type YamlRead =
  | { readonly ok: true; readonly value: Json; readonly lineOf: (path: YamlPath) => number | undefined }
  | { readonly ok: false; readonly problems: readonly YamlProblem[] };

const yamlLimits = {
  characters: 262_144,
  nesting: 64,
  aliasedNodes: 100,
} as const;

const yamlTagPrefix = "tag:yaml.org,2002:";

const yamlOwnTags: readonly string[] = ["str", "int", "float", "bool", "null", "map", "seq"];

const nonSpecificTag = "!";

const unresolvedTag = "TAG_RESOLVE_FAILED";

const exhausted = "RESOURCE_EXHAUSTION";

type YamlPackage = typeof Yaml;

type Reading = {
  readonly yaml: YamlPackage;
  readonly document: Yaml.Document.Parsed;
  readonly lineAt: (offset: number) => number;
};

const requireFromKernel = createRequire(import.meta.url);

let loadedYaml: YamlPackage | undefined;

function isYamlPackage(value: unknown): value is YamlPackage {
  return typeof value === "object" && value !== null && "parseDocument" in value && "visit" in value;
}

function yamlPackage(): YamlPackage {
  if (loadedYaml === undefined) {
    const required: unknown = requireFromKernel("yaml");
    if (!isYamlPackage(required)) {
      throw new Error("The yaml package did not load as a package with parseDocument and visit.");
    }
    loadedYaml = required;
  }
  return loadedYaml;
}

function failed(problems: readonly YamlProblem[]): YamlRead {
  return { ok: false, problems };
}

function lineOfNode(reading: Reading, node: Yaml.Node): number {
  return node.range === undefined || node.range === null ? 1 : reading.lineAt(node.range[0]);
}

const ownTagList = `${yamlOwnTags.slice(0, -1).join(", ")} and ${yamlOwnTags.at(-1) ?? ""}`;

function isOwnTag(tag: string): boolean {
  return tag === nonSpecificTag || yamlOwnTags.some((name) => tag === `${yamlTagPrefix}${name}`);
}

function shownTag(tag: string): string {
  return tag.startsWith(yamlTagPrefix) ? `!!${tag.slice(yamlTagPrefix.length)}` : tag;
}

function tooLong(text: string): YamlProblem {
  return {
    line: 1,
    message: `The YAML is ${String(text.length)} characters long, more than the ${String(yamlLimits.characters)} a YAML text may have.`,
    fix: "Make the text shorter.",
  };
}

function tooDeep(line: number): YamlProblem {
  return {
    line,
    message: `The YAML is nested more than ${String(yamlLimits.nesting)} levels deep at this line.`,
    fix: "Nest the text less deeply.",
  };
}

function nodeProblem(reading: Reading, node: Yaml.Node, depth: number): YamlProblem | undefined {
  const line = lineOfNode(reading, node);
  if (depth > yamlLimits.nesting) {
    return tooDeep(line);
  }
  if (node.tag !== undefined && !isOwnTag(node.tag)) {
    return {
      line,
      message: `The YAML has the tag ${shownTag(node.tag)}, which is not one of YAML's own: ${ownTagList}.`,
      fix: "Remove the tag and write the value as plain YAML.",
    };
  }
  if (reading.yaml.isScalar(node) && typeof node.value === "number" && !Number.isFinite(node.value)) {
    return {
      line,
      message: `The YAML has the number ${node.source ?? String(node.value)} at this line, which JSON cannot hold.`,
      fix: "Write a finite number.",
    };
  }
  return undefined;
}

function nodeProblems(reading: Reading): readonly YamlProblem[] {
  const problems: YamlProblem[] = [];
  const { isCollection, isNode, visit } = reading.yaml;
  visit(reading.document, (_key, node, path) => {
    if (!isNode(node)) {
      return undefined;
    }
    const depth = path.filter((ancestor) => isCollection(ancestor)).length + (isCollection(node) ? 1 : 0);
    const problem = nodeProblem(reading, node, depth);
    if (problem === undefined) {
      return undefined;
    }
    problems.push(problem);
    return visit.SKIP;
  });
  return problems;
}

function syntaxProblems(reading: Reading): readonly YamlProblem[] {
  const { errors } = reading.document;
  const tooDeepAt = errors.find((error) => error.code === exhausted);
  if (tooDeepAt !== undefined) {
    return [tooDeep(reading.lineAt(tooDeepAt.pos[0]))];
  }
  const warnings = reading.document.warnings.filter((warning) => warning.code !== unresolvedTag);
  return [...errors, ...warnings].map((error) => ({
    line: reading.lineAt(error.pos[0]),
    message: `The YAML cannot be read: ${error.message}.`,
    fix: "Correct the YAML syntax at this line.",
  }));
}

function firstAliasLine(reading: Reading): number {
  let line = 1;
  const { visit } = reading.yaml;
  visit(reading.document, {
    Alias: (_key, node) => {
      line = lineOfNode(reading, node);
      return visit.BREAK;
    },
  });
  return line;
}

function valueOf(reading: Reading): YamlRead {
  let value: unknown;
  try {
    value = reading.document.toJS({ maxAliasCount: yamlLimits.aliasedNodes });
  } catch (error) {
    if (!(error instanceof ReferenceError)) {
      throw error;
    }
    return failed([
      {
        line: firstAliasLine(reading),
        message: `The YAML's aliases would copy more than ${String(yamlLimits.aliasedNodes)} nodes.`,
        fix: "Write the repeated part out, or use fewer aliases.",
      },
    ]);
  }
  if (!isJson(value)) {
    return failed([{ line: 1, message: "The YAML holds a value JSON cannot hold.", fix: "Write plain YAML." }]);
  }
  const lineOf = (path: YamlPath): number | undefined => {
    const node = reading.document.getIn(path, true);
    return reading.yaml.isNode(node) && node.range ? reading.lineAt(node.range[0]) : undefined;
  };
  return { ok: true, value, lineOf };
}

export function readYaml(text: string): YamlRead {
  if (text.length > yamlLimits.characters) {
    return failed([tooLong(text)]);
  }
  const yaml = yamlPackage();
  const lineCounter = new yaml.LineCounter();
  const document = yaml.parseDocument(text, { lineCounter, prettyErrors: false, schema: "core" });
  const reading: Reading = { yaml, document, lineAt: (offset) => lineCounter.linePos(offset).line };
  const syntax = syntaxProblems(reading);
  if (syntax.length > 0) {
    return failed(syntax);
  }
  const nodes = nodeProblems(reading);
  return nodes.length > 0 ? failed(nodes) : valueOf(reading);
}
