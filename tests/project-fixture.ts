import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";

export const kit = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

type SdkImport = "relative" | "specifier";

let sdkImport: SdkImport = "specifier";

function script(lines: readonly string[]): string {
  const from = sdkImport === "relative" ? "../../../../bay/sdk.ts" : "agentbay/sdk";
  return [`import { defineScript, fail } from ${JSON.stringify(from)};`, "", ...lines, ""].join("\n");
}

function schema(properties: Readonly<Record<string, unknown>>, required: readonly string[]): string {
  return `${JSON.stringify({ type: "object", additionalProperties: false, required, properties }, null, 2)}\n`;
}

const nameSchema = schema({ name: { type: "string" } }, ["name"]);

const greetingSchema = schema({ greeting: { type: "string" } }, ["greeting"]);

const draftSchema = schema({ text: { type: "string" } }, ["text"]);

const composedSchema = schema({ text: { type: "string" }, saved: { type: "string" } }, ["text", "saved"]);

export const skillText = [
  "---",
  "name: draft",
  "description: Writes a short note that greets the person named in the input.",
  "metadata:",
  "  output: schemas/draft-output.json",
  "---",
  "",
  "## Input",
  "",
  "A name and a greeting, as schemas/compose-input.json plus the greeting.",
  "",
  "## Output",
  "",
  "One note, as schemas/draft-output.json.",
  "",
  "## Definition of done",
  "",
  "- [DOD-1] (must) The note is at least twenty characters long; scripts/long-enough.ts checks it.",
  "",
  "## Instructions",
  "",
  "1. Read the earlier notes with db_query.",
  "2. Write a note that uses the greeting and the name.",
  "",
  "## Tools",
  "",
  "- db",
  "- files",
  "- greeting-source.fetch",
  "- compose",
  "",
  "## Resources",
  "",
  "- out/notes/",
  "",
  "## Rules and constraints",
  "",
  "- Never write outside out/notes/.",
  "",
].join("\n");

const greeterMode = {
  name: "greeter",
  version: "1.0.0",
  description: "Gives a greeting for a name.",
  implements: ["greeting-source@1"],
  actions: {
    fetch: {
      input: "schemas/fetch-input.json",
      output: "schemas/fetch-output.json",
      effects: ["read"],
      run: [{ script: "scripts/fetch.ts" }],
    },
    tally: {
      input: "schemas/fetch-input.json",
      output: "schemas/fetch-output.json",
      effects: ["read", "spend"],
      budget: { tokens: 5 },
      run: [{ script: "scripts/spend.ts" }, { script: "scripts/fetch.ts" }],
    },
  },
};

const writerMode = {
  name: "writer",
  version: "1.0.0",
  description: "Drafts a note from a greeting and keeps it.",
  requires: { interfaces: ["greeting-source@1"] },
  resources: { db: { migrations: "migrations" }, files: { write: ["out/notes/"] } },
  settings: "schemas/settings.json",
  actions: {
    compose: {
      input: "schemas/compose-input.json",
      output: "schemas/compose-output.json",
      effects: ["read", "write"],
      run: [
        { script: "scripts/prepare.ts" },
        { skill: "skills/draft", tier: "balanced", checks: ["scripts/long-enough.ts"] },
        { script: "scripts/finish.ts" },
      ],
    },
  },
  workflows: ["workflows/review.yaml"],
};

const reviewWorkflow = {
  name: "review",
  trigger: { manual: true },
  steps: [
    { id: "fetch", action: "greeting-source.fetch" },
    { id: "keep", approval: "Keep this greeting?", show: "$steps.fetch.output" },
  ],
};

function interfaceFiles(folder: string): Record<string, string> {
  const definition = {
    name: "greeting-source",
    version: 1,
    actions: {
      fetch: {
        input: "greeting-source/fetch-input.json",
        output: "greeting-source/fetch-output.json",
        effects: ["read"],
      },
    },
  };
  return {
    [`${folder}/greeting-source.yaml`]: stringify(definition),
    [`${folder}/greeting-source/fetch-input.json`]: nameSchema,
    [`${folder}/greeting-source/fetch-output.json`]: greetingSchema,
  };
}

function greeterFiles(): Record<string, string> {
  const folder = "components/modes/greeter";
  return {
    [`${folder}/mode.yaml`]: stringify(greeterMode),
    [`${folder}/schemas/fetch-input.json`]: nameSchema,
    [`${folder}/schemas/fetch-output.json`]: greetingSchema,
    [`${folder}/scripts/fetch.ts`]: script([
      "void fail;",
      "export const run = defineScript(async (input) => {",
      '  const name = typeof input === "object" && input !== null && "name" in input ? String(input.name) : "";',
      "  return { greeting: `Hello, ${name}` };",
      "});",
    ]),
    [`${folder}/scripts/spend.ts`]: script([
      "export const run = defineScript(async (input, context) => {",
      "  const spent = await context.spend({ tokens: 10 });",
      "  return spent.ok ? input : fail(spent.message);",
      "});",
    ]),
    [`${folder}/tests/tally.example.json`]: JSON.stringify({
      input: { name: "Ada" },
      output: { greeting: "Hello, Ada" },
    }),
    [`${folder}/tests/fetch.example.json`]: JSON.stringify({
      input: { name: "Ada" },
      output: { greeting: "Hello, Ada" },
    }),
  };
}

function writerScripts(folder: string): Record<string, string> {
  return {
    [`${folder}/scripts/prepare.ts`]: script([
      "export const run = defineScript(async (input, context) => {",
      '  const name = typeof input === "object" && input !== null && "name" in input ? String(input.name) : "";',
      '  const answer = await context.call("greeting-source.fetch", { name });',
      "  if (!answer.ok) {",
      "    return fail(answer.message);",
      "  }",
      "  return { name, greeting: answer.value };",
      "});",
    ]),
    [`${folder}/scripts/long-enough.ts`]: script([
      "void fail;",
      "export const run = defineScript(async (input) => {",
      '  const text = typeof input === "object" && input !== null && "text" in input ? String(input.text) : "";',
      "  if (text.length >= 20) {",
      "    return { passed: true };",
      "  }",
      "  return { passed: false, feedback: `The note has ${String(text.length)} characters; write at least 20.` };",
      "});",
    ]),
    [`${folder}/scripts/finish.ts`]: script([
      "export const run = defineScript(async (input, context) => {",
      '  const text = typeof input === "object" && input !== null && "text" in input ? String(input.text) : "";',
      '  const written = await context.files.write("out/notes/note.txt", text);',
      "  if (!written.ok) {",
      "    return fail(written.message);",
      "  }",
      '  return { text, saved: "out/notes/note.txt" };',
      "});",
    ]),
  };
}

function writerFiles(): Record<string, string> {
  const folder = "components/modes/writer";
  const example = {
    input: { name: "Ada" },
    output: { text: "Hello, Ada, and welcome back.", saved: "out/notes/note.txt" },
  };
  return {
    [`${folder}/mode.yaml`]: stringify(writerMode),
    [`${folder}/schemas/compose-input.json`]: nameSchema,
    [`${folder}/schemas/compose-output.json`]: composedSchema,
    [`${folder}/schemas/draft-output.json`]: draftSchema,
    [`${folder}/schemas/settings.json`]: schema(
      { signature: { type: "string", description: "The words that end every note." } },
      [],
    ),
    [`${folder}/skills/draft/SKILL.md`]: skillText,
    [`${folder}/workflows/review.yaml`]: stringify(reviewWorkflow),
    [`${folder}/migrations/0001-notes.sql`]:
      "create table notes (id integer primary key, text text not null);\n" +
      "insert into notes (text) values ('The first note.');\n",
    [`${folder}/tests/compose.example.json`]: JSON.stringify(example),
    ...writerScripts(folder),
  };
}

export type ProjectOptions = {
  readonly approvalsFrom?: readonly string[];
  readonly adapter?: string;
  readonly ownKernel?: boolean;
};

function configText(options: ProjectOptions = {}): string {
  const config = {
    bindings: { "greeting-source": "greeter" },
    adapter: options.adapter ?? "fake",
    settings: { writer: { signature: "Yours, the writer" } },
    ...(options.approvalsFrom === undefined ? {} : { approvals: { from: options.approvalsFrom } }),
  };
  return stringify(config);
}

const ignored = [".agentbay/", "out/", "bay", "schemas", "node_modules", "package.json"];

function projectFiles(options: ProjectOptions = {}): Record<string, string> {
  const ownKernel = options.ownKernel === true;
  sdkImport = ownKernel ? "relative" : "specifier";
  return {
    "agentbay.config.yaml": configText(options),
    ".gitignore": `${ignored.join("\n")}\n`,
    ...interfaceFiles(ownKernel ? "components/base/interfaces" : "components/interfaces"),
    ...greeterFiles(),
    ...writerFiles(),
  };
}

export type Project = {
  readonly root: string;
  readonly cli: string;
  readonly write: (path: string, text: string) => Promise<void>;
  readonly read: (path: string) => Promise<string>;
  readonly remove: () => Promise<void>;
};

export async function makeProject(options: ProjectOptions = {}): Promise<Project> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-project-")));
  const write = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, "utf8");
  };
  for (const [path, text] of Object.entries(projectFiles(options))) {
    await write(path, text);
  }
  if (options.ownKernel === true) {
    await write("framework/limits.yaml", await readFile(join(kit, "framework", "limits.yaml"), "utf8"));
    await cp(join(kit, "bay"), join(root, "bay"), { recursive: true });
    await cp(join(kit, "schemas"), join(root, "schemas"), { recursive: true });
    await cp(join(kit, "package.json"), join(root, "package.json"));
    await symlink(join(kit, "node_modules"), join(root, "node_modules"));
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  return {
    root,
    cli: join(options.ownKernel === true ? root : kit, "bay", "cli.ts"),
    write,
    read: (path) => readFile(join(root, path), "utf8"),
    remove: () => rm(root, { recursive: true, force: true }),
  };
}
