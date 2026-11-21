import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { commandNames } from "./cli-fixture.ts";
import { kit } from "./project-fixture.ts";

const modeReadmes = readdirSync(join(kit, "components"), { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith("README.md"))
  .map((path) => `components/${path}`);

const frontDoorDocuments = [
  "README.md",
  "CONTEXT.md",
  "docs/DESIGN.md",
  "docs/INTERFACES.md",
  "adapters/claude-code/README.md",
  ...modeReadmes,
];

const kitFolders = ["adapters", "bay", "components", "docs", "framework", "schemas", "tests"];

const modeFolderParts = ["migrations", "schemas", "scripts", "skills", "tests", "workflows"];

const fencedBlock = /```[^\n]*\n([\s\S]*?)```/g;

const pathShape = /^(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@-]*$/;

type Named = { readonly document: string; readonly named: string };

function textOf(document: string): string {
  return readFileSync(join(kit, document), "utf8");
}

function fencedCodeIn(text: string): readonly string[] {
  return [...text.matchAll(fencedBlock)].map((match) => match[1] ?? "");
}

function inlineCodeIn(text: string): readonly string[] {
  return [...text.replace(fencedBlock, "").matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

function linksIn(text: string): readonly string[] {
  const targets = [...text.replace(fencedBlock, "").matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)];
  return targets.map((match) => match[1] ?? "").filter((target) => !/^[a-z]+:/.test(target));
}

function commandsNamedIn(code: string): readonly string[] {
  const named = code.matchAll(/(?:^|[\s$'"(])(?:\S*\/)?bay(?:\.sh)? ([a-z][a-z0-9-]*)/g);
  return [...named].map((match) => match[1] ?? "");
}

function wordsOf(code: string): readonly string[] {
  return code
    .split(/\s+/)
    .map((word) => word.replace(/[,;:)]+$/, "").replace(/#.*$/, ""))
    .filter((word) => pathShape.test(word));
}

function modeFolderOf(document: string): string | undefined {
  const folder = dirname(document);
  return existsSync(join(kit, folder, "mode.yaml")) ? folder : undefined;
}

function firstPart(path: string): string {
  return path.split("/")[0] ?? "";
}

function rootOf(document: string, path: string): string | undefined {
  const modeFolder = modeFolderOf(document);
  if (modeFolder !== undefined && modeFolderParts.includes(firstPart(path))) {
    return modeFolder;
  }
  return kitFolders.includes(firstPart(path)) ? "." : undefined;
}

function checkedPathsIn(document: string): readonly Named[] {
  const text = textOf(document);
  const code = [...inlineCodeIn(text), ...fencedCodeIn(text)].flatMap(wordsOf);
  const fromCode = code.flatMap((path) => {
    const root = rootOf(document, path);
    return root === undefined ? [] : [{ document, named: join(root, path) }];
  });
  const fromLinks = linksIn(text).map((target) => ({ document, named: join(dirname(document), target) }));
  return [...fromCode, ...fromLinks];
}

function commandsIn(document: string): readonly Named[] {
  const text = textOf(document);
  const code = [...fencedCodeIn(text), ...inlineCodeIn(text)];
  return code.flatMap((part) => commandsNamedIn(part).map((named) => ({ document, named })));
}

function documentsWithNone(found: readonly Named[]): readonly string[] {
  return frontDoorDocuments.filter((document) => !found.some((each) => each.document === document));
}

test("every bay command named in a front-door document's code is one that bay --help lists", async () => {
  const known = await commandNames();
  const named = frontDoorDocuments.flatMap(commandsIn);
  assert.deepEqual(documentsWithNone(named), ["components/base/requirements/README.md"]);
  assert.deepEqual(
    named
      .filter(({ named: name }) => !known.includes(name))
      .map(({ document, named: name }) => `${document}: bay ${name}`),
    [],
  );
});

test("every path a front-door document names exists, a mode's own parts in the mode's folder", () => {
  const named = frontDoorDocuments.flatMap(checkedPathsIn);
  assert.deepEqual(documentsWithNone(named), []);
  assert.deepEqual(
    named
      .filter(({ named: path }) => !existsSync(join(kit, path)))
      .map(({ document, named: path }) => `${document}: ${path}`),
    [],
  );
});
