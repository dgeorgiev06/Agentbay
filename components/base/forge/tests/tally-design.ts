import type { Json } from "../../../../bay/sdk.ts";
import type { ToTry } from "../scripts/lib/tried-examples.ts";

export const emptyName = "The name is empty; give a name of 1 to 20 characters.";

const added = (name: string): Json => ({ action: "add", input: { name } });

export const twentyA = "a".repeat(20);

const addExamples: readonly Json[] = [
  { input: { name: "ann" }, answer: { name: "ann", count: 1 } },
  { earlier: [added("ann")], input: { name: "ann" }, answer: { name: "ann", count: 2 } },
  { input: { name: "" }, refusal: emptyName },
  { input: { name: { $text: [{ repeat: "a", times: 20 }] } }, answer: { name: twentyA, count: 1 } },
];

const countExamples: readonly Json[] = [{ earlier: [added("bo")], input: { name: "bo" }, answer: { count: 1 } }];

export const addToTry: ToTry = { action: "counting.add", mode: "tally", examples: addExamples };

export const countToTry: ToTry = { action: "counting.count", mode: "tally", examples: countExamples };

export const inRounds = { built: ["counting.add"], room: 100, notBuilt: "which this slice does not build" };

const nameRequest = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: { name: { type: "string", maxLength: 20 } },
};

export type TallyVariant = "as designed" | "counts once" | "refuses tersely" | "broken manifest";

function addScript(variant: TallyVariant): string {
  const refusal = variant === "refuses tersely" ? "Name missing." : emptyName;
  const counted = variant === "counts once" ? "1" : "(counts[name] ?? 0) + 1";
  return [
    'import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";',
    "",
    "export const run = defineScript(async (input, context) => {",
    "  const name = String(fieldsOf(input).name);",
    '  if (name === "") {',
    `    return fail(${JSON.stringify(refusal)});`,
    "  }",
    '  const read = await context.files.read(".tally/counts.json");',
    "  const counts = read.ok ? fieldsOf(JSON.parse(read.value)) : {};",
    `  const count = ${counted};`,
    '  await context.files.write(".tally/counts.json", JSON.stringify({ ...counts, [name]: count }));',
    "  return { name, count };",
    "});",
    "",
  ].join("\n");
}

const countScript = [
  'import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";',
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const name = String(fieldsOf(input).name);",
  '  const read = await context.files.read(".tally/counts.json");',
  "  const counts = read.ok ? fieldsOf(JSON.parse(read.value)) : {};",
  "  return { count: Number(counts[name] ?? 0) };",
  "});",
  "",
].join("\n");

const manifest = [
  "name: tally",
  "version: 1.0.0",
  "description: A made-up mode for forge's test; it counts names.",
  "resources:",
  "  files: { read: [.tally/], write: [.tally/] }",
  "actions:",
  "  add:",
  "    description: When a name is to be counted once more.",
  "    input: schemas/add-request.json",
  "    output: schemas/add-response.json",
  "    effects: [read, write]",
  "    run:",
  "      - script: scripts/add.ts",
  "  count:",
  "    description: When a name's count is asked.",
  "    input: schemas/count-request.json",
  "    output: schemas/count-response.json",
  "    effects: [read]",
  "    run:",
  "      - script: scripts/count.ts",
  "",
].join("\n");

function schema(value: { readonly [key: string]: Json }): string {
  return `${JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", ...value })}\n`;
}

export function tallyFiles(variant: TallyVariant): Readonly<Record<string, string>> {
  const folder = "components/modes/tally";
  return {
    [`${folder}/mode.yaml`]: variant === "broken manifest" ? `${manifest}builder-key: [\n` : manifest,
    [`${folder}/schemas/add-request.json`]: schema(nameRequest),
    [`${folder}/schemas/add-response.json`]: schema({
      type: "object",
      required: ["name", "count"],
      properties: { name: { type: "string" }, count: { type: "integer" } },
    }),
    [`${folder}/schemas/count-request.json`]: schema(nameRequest),
    [`${folder}/schemas/count-response.json`]: schema({
      type: "object",
      required: ["count"],
      properties: { count: { type: "integer" } },
    }),
    [`${folder}/scripts/add.ts`]: addScript(variant),
    [`${folder}/scripts/count.ts`]: countScript,
  };
}
