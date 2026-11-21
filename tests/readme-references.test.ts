import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { commandNames } from "./cli-fixture.ts";
import { kit } from "./project-fixture.ts";

const readmes = [
  "README.md",
  "adapters/claude-code/README.md",
  ...readdirSync(join(kit, "components"), { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith("README.md"))
    .map((path) => `components/${path}`),
];

const frontDoorDocuments = [...readmes, "CONTEXT.md", "docs/DESIGN.md", "docs/INTERFACES.md"];

const kitFolders = ["adapters/", "bay/", "components/", "docs/", "framework/", "schemas/", "tests/"];

const fencedBlock = /```[^\n]*\n([\s\S]*?)```/g;

function textOf(document: string): string {
  return readFileSync(join(kit, document), "utf8");
}

function inlineCodeIn(text: string): readonly string[] {
  return [...text.replace(fencedBlock, "").matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

function codeIn(text: string): readonly string[] {
  const blocks = [...text.matchAll(fencedBlock)].map((match) => match[1] ?? "");
  return [...blocks, ...inlineCodeIn(text)];
}

function commandsNamedIn(code: string): readonly string[] {
  const named = code.matchAll(/(?:^|[\s$'"(])(?:\S*\/)?bay(?:\.sh)? ([a-z][a-z0-9-]*)/g);
  return [...named].map((match) => match[1] ?? "");
}

function isKitPath(code: string): boolean {
  return kitFolders.some((folder) => code.startsWith(folder)) && !/[\s<>*{}$|]/.test(code);
}

function existsFor(document: string, path: string): boolean {
  return [join(kit, path), join(kit, dirname(document), path)].some((candidate) => existsSync(candidate));
}

test("every bay command named in a README's code is one that bay --help lists", async () => {
  const known = await commandNames();
  const named = readmes.flatMap((document) =>
    codeIn(textOf(document)).flatMap((code) => commandsNamedIn(code).map((name) => ({ document, name }))),
  );
  assert.ok(named.length > 40, String(named.length));
  assert.deepEqual(
    named.filter(({ name }) => !known.includes(name)).map(({ document, name }) => `${document}: bay ${name}`),
    [],
  );
});

test("every kit path a front-door document names exists, from the kit's folder or from the document's", () => {
  const named = frontDoorDocuments.flatMap((document) =>
    inlineCodeIn(textOf(document))
      .map((code) => code.replace(/#.*$/, ""))
      .filter(isKitPath)
      .map((path) => ({ document, path })),
  );
  assert.ok(named.length > 40, String(named.length));
  assert.deepEqual(
    named
      .filter(({ document, path }) => !existsFor(document, path))
      .map(({ document, path }) => `${document}: ${path}`),
    [],
  );
});
