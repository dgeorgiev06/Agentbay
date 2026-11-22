import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Json, ScriptContext } from "../../../../bay/sdk.ts";

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

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quotedIn(text: string): readonly string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

async function sheetText(): Promise<string> {
  return readFile(join(modeFolder, sheetPath), "utf8");
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
