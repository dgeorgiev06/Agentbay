import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { stringify } from "yaml";
import { openKernel } from "./kernel-fixture.ts";
import { makeProject } from "./project-fixture.ts";

const todo = {
  name: "jotter",
  version: "1.0.0",
  description: "Keeps todos in its own database.",
  resources: { db: { migrations: "migrations" } },
  workflows: ["workflows/both.yaml"],
  actions: {
    add: {
      description: "When a test adds a todo to the mode's own database.",
      input: "schemas/anything.json",
      output: "schemas/anything.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/add.ts" }],
    },
  },
};

const both = {
  name: "both",
  steps: [
    {
      id: "each",
      foreach: "$trigger",
      sideBySide: 2,
      steps: [{ id: "add", action: "add", input: { title: "$item" } }],
    },
  ],
};

const addScript = [
  'import { defineScript, fail } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const added = await context.db.execute("insert into todos (title) values (?)", [String(input.title)]);',
  "  return added.ok ? { added: input.title } : fail(added.message);",
  "});",
  "",
].join("\n");

test("two side-by-side items that each write through a mode's database both leave their row", async () => {
  const project = await makeProject();
  const folder = "components/modes/jotter";
  await project.write(`${folder}/mode.yaml`, stringify(todo));
  await project.write(`${folder}/workflows/both.yaml`, stringify(both));
  await project.write(`${folder}/schemas/anything.json`, '{ "type": "object" }\n');
  await project.write(`${folder}/migrations/0001-todos.sql`, "create table todos (title text not null);\n");
  await project.write(`${folder}/scripts/add.ts`, addScript);
  const kernel = await openKernel(project);
  try {
    const run = await kernel.runs.start({ workflow: { mode: "jotter", path: "workflows/both.yaml" } }, ["one", "two"]);
    assert.ok(run.ok, JSON.stringify(run));
    assert.deepEqual(run.value.state, { status: "done", output: [{ added: "one" }, { added: "two" }] });
    const database = new DatabaseSync(join(project.root, ".agentbay/data/jotter.db"), { readOnly: true });
    const rows = database.prepare("select title from todos order by title").all();
    database.close();
    assert.deepEqual(
      rows.map((row) => row.title),
      ["one", "two"],
    );
  } finally {
    kernel.close();
    await project.remove();
  }
});
