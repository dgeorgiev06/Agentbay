import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { commandLineIn } from "../../../../tests/test-toolbox.ts";
import { exampleFile, exampleFilePattern } from "../scripts/lib/example-files.ts";
import { jsonOf, listOf } from "./kit-copy.ts";

type Fields = { readonly [key: string]: Json };

const modeFolder = join(import.meta.dirname, "..");

const kitFolder = join(modeFolder, "../../..");

const sheetPath = "skills/kit-for-a-mode.md";

const skillsNamingTheSheet = ["design", "declare", "write-tests", "build", "build-without-tests"];

const contextMembers: Record<keyof ScriptContext, true> = {
  db: true,
  files: true,
  secrets: true,
  http: true,
  events: true,
  commands: true,
  call: true,
  schemas: true,
  settings: true,
  now: true,
  spend: true,
  random: true,
  caller: true,
  skillInput: true,
};

const anyName = /^<[a-z-]+>$/;

const madeUpMode = "components/modes/notes";

const textSchema = JSON.stringify({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string" } },
});

const projectWithoutExample: Readonly<Record<string, string>> = {
  "agentbay.config.yaml": "modes: [notes]\nbindings: {}\nadapter: claude-code\n",
  [`${madeUpMode}/mode.yaml`]: [
    "name: notes",
    "version: 1.0.0",
    "description: Keeps notes; a made-up mode with one action and no example file.",
    "actions:",
    "  add:",
    "    description: When a note is to be kept.",
    "    input: schemas/add-request.json",
    "    output: schemas/add-response.json",
    "    effects: [read]",
    "    run:",
    "      - script: scripts/add.ts",
    "",
  ].join("\n"),
  [`${madeUpMode}/schemas/add-request.json`]: textSchema,
  [`${madeUpMode}/schemas/add-response.json`]: textSchema,
  [`${madeUpMode}/scripts/add.ts`]: [
    'import { defineScript } from "agentbay/sdk";',
    "",
    "export const run = defineScript((input) => Promise.resolve(input));",
    "",
  ].join("\n"),
};

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quotedIn(text: string): readonly string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

async function sheetText(): Promise<string> {
  return readFile(join(modeFolder, sheetPath), "utf8");
}

async function madeUpProject(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-kit-sheet-")));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, "utf8");
  }
  return root;
}

function quotedSentenceOn(text: string, start: string): string {
  const inOneLine = text.replace(/\s+/g, " ");
  const found = new RegExp(`"(${start}[^"]*)"`).exec(inOneLine);
  return found?.[1] ?? "";
}

async function manifestForm(): Promise<Fields> {
  const parsed: unknown = JSON.parse(await readFile(join(kitFolder, "schemas/mode.schema.json"), "utf8"));
  assert.ok(isFields(parsed), "the manifest's form is a JSON object");
  return parsed;
}

function resolved(form: Fields, node: Json | undefined): Json | undefined {
  if (!isFields(node) || typeof node.$ref !== "string") {
    return node;
  }
  const name = node.$ref.replace("#/$defs/", "");
  const definitions = form.$defs;
  return resolved(form, isFields(definitions) ? definitions[name] : undefined);
}

function fieldAt(form: Fields, node: Json | undefined, segment: string): Json | undefined {
  const here = resolved(form, node);
  if (!isFields(here)) {
    return undefined;
  }
  if (anyName.test(segment)) {
    return here.additionalProperties;
  }
  const properties = here.properties;
  return isFields(properties) ? properties[segment] : undefined;
}

function existsInForm(form: Fields, path: string): boolean {
  let node: Json | undefined = form;
  for (const segment of path.split(".")) {
    node = fieldAt(form, node, segment);
    if (node === undefined) {
      return false;
    }
  }
  return true;
}

function manifestPathsIn(text: string, form: Fields): readonly string[] {
  const topFields = Object.keys(isFields(form.properties) ? form.properties : {});
  return quotedIn(text).filter((quoted) => {
    const [first = "", ...rest] = quoted.split(".");
    return rest.length > 0 && topFields.includes(first) && /^[A-Za-z<>.-]+$/.test(quoted);
  });
}

test("every dotted mode.yaml field the sheet quotes is a field of the manifest's form", async () => {
  const form = await manifestForm();
  const quoted = manifestPathsIn(await sheetText(), form);
  assert.ok(quoted.includes("resources.db.migrations"), "the sheet names the key of a mode's database");
  assert.deepEqual(
    quoted.filter((path) => !existsInForm(form, path)),
    [],
    "each field the sheet quotes is in schemas/mode.schema.json",
  );
});

test("the sheet quotes the manifest's own sentence on paths relative to the mode's folder", async () => {
  const relativePath = resolved(await manifestForm(), { $ref: "#/$defs/relativePath" });
  assert.ok(isFields(relativePath) && typeof relativePath.description === "string");
  const sheetInOneLine = (await sheetText()).replace(/\s+/g, " ");
  assert.ok(
    sheetInOneLine.includes(`"${relativePath.description}"`),
    "the sheet quotes the description of relativePath word for word",
  );
});

test("the sheet names every member a script's context has, and no other", async () => {
  const named = quotedIn(await sheetText()).flatMap((quoted) => {
    const match = /^context\.([A-Za-z]+)/.exec(quoted);
    return match?.[1] === undefined ? [] : [match[1]];
  });
  assert.deepEqual([...new Set(named)].sort(), Object.keys(contextMembers).sort());
});

test("the skills that design, declare, test and build a mode name the sheet in their Resources", async () => {
  for (const skill of skillsNamingTheSheet) {
    const text = await readFile(join(modeFolder, "skills", skill, "SKILL.md"), "utf8");
    const resources = text.split("\n## ").find((section) => section.startsWith("Resources")) ?? "";
    assert.ok(resources.includes(`- \`${sheetPath}\`: `), `the skill ${skill} names the sheet in its Resources`);
  }
});

test("the sheet quotes the example file's name as forge's declare check builds it", async () => {
  assert.equal(exampleFilePattern, "tests/<action>.example.json");
  assert.ok(quotedIn(await sheetText()).includes(exampleFilePattern), "the sheet quotes the example file's name");
  assert.equal(exampleFile(madeUpMode, "add"), `${madeUpMode}/tests/add.example.json`);
});

test("a made-up mode with an action and no example file fails bay check with the sentence the sheet quotes", async () => {
  const root = await madeUpProject(projectWithoutExample);
  try {
    const checked = await (await commandLineIn(kitFolder))(["check", "--project", root, "--json"]);
    const file = exampleFile(madeUpMode, "add");
    const quoted = quotedSentenceOn(await sheetText(), "Action <action>");
    const expected = quoted.replace("<action>", "add").replace("<mode>", "notes").replace("<file>", file);
    const findings = fieldsOf(jsonOf(checked.output)).findings;
    assert.equal(
      expected,
      "Action add of mode notes has no example: components/modes/notes/tests/add.example.json does not exist.",
      "the sheet quotes the sentence with the action, the mode and the file in their places",
    );
    assert.equal(checked.exitCode, 1, "bay check fails");
    assert.deepEqual(
      listOf(findings).map((finding) => fieldsOf(finding).message),
      [expected],
      "the one error is the sentence the sheet quotes, for the file the sheet names",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
