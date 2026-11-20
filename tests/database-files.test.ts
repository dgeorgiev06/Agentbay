import assert from "node:assert/strict";
import { chmod, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Kernel } from "../bay/kernel.ts";
import { openKernel } from "./kernel-fixture.ts";
import { makeProject, type Project } from "./project-fixture.ts";

type Entry = {
  readonly path: string;
  readonly mode: number;
};

const keeper = {
  name: "keeper",
  version: "1.0.0",
  description: "Keeps a note in a partition of its own database.",
  resources: { db: { migrations: "migrations" } },
  actions: {
    keep: {
      description: "When a test needs a run that writes a database partition.",
      input: "schemas/anything.json",
      output: "schemas/anything.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/keep.ts" }],
    },
    prepare: {
      description: "When a test needs a run that only migrates a database partition.",
      input: "schemas/anything.json",
      output: "schemas/anything.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/prepare.ts" }],
    },
  },
};

const keepScript = [
  'import { defineScript, fail } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (_input, context) => {",
  '  const partition = context.db.partition("notes");',
  "  const migrated = await partition.migrate();",
  "  if (!migrated.ok) {",
  "    return fail(migrated.message);",
  "  }",
  "  const kept = await partition.execute(\"insert into kept (text) values ('a note')\");",
  "  return kept.ok ? { kept: true } : fail(kept.message);",
  "});",
  "",
].join("\n");

const prepareScript = [
  'import { defineScript, fail } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (_input, context) => {",
  '  const migrated = await context.db.partition("notes").migrate();',
  "  return migrated.ok ? { migrated: migrated.value } : fail(migrated.message);",
  "});",
  "",
].join("\n");

async function projectWithKeeper(): Promise<Project> {
  const project = await makeProject();
  const folder = "components/modes/keeper";
  await project.write(`${folder}/mode.yaml`, stringify(keeper));
  await project.write(`${folder}/schemas/anything.json`, '{ "type": "object" }\n');
  await project.write(`${folder}/migrations/0001-kept.sql`, "create table kept (text text not null);\n");
  await project.write(`${folder}/scripts/keep.ts`, keepScript);
  await project.write(`${folder}/scripts/prepare.ts`, prepareScript);
  return project;
}

async function entriesOf(root: string): Promise<readonly Entry[]> {
  const entries: Entry[] = [];
  for (const folder of [".agentbay", join(".agentbay", "data")]) {
    entries.push({ path: folder, mode: (await stat(join(root, folder))).mode & 0o777 });
    for (const name of await readdir(join(root, folder))) {
      if (name.includes(".db")) {
        const path = join(folder, name);
        entries.push({ path, mode: (await stat(join(root, path))).mode & 0o777 });
      }
    }
  }
  return entries;
}

function assertOwnerOnly(entries: readonly Entry[]): void {
  for (const entry of entries) {
    const expected = entry.path.includes(".db") ? 0o600 : 0o700;
    assert.equal(entry.mode, expected, `${entry.path} has mode ${entry.mode.toString(8)}`);
  }
}

async function kept(kernel: Kernel, action = "keeper.keep"): Promise<void> {
  const run = await kernel.runs.start({ action }, {});
  assert.ok(run.ok && run.value.state.status === "done", JSON.stringify(run));
}

test("after a run and a partition write the folders are 0700 and every database file is 0600", async () => {
  const project = await projectWithKeeper();
  const kernel = await openKernel(project);
  try {
    await kept(kernel);
    const entries = await entriesOf(project.root);
    const names = entries.map((entry) => entry.path);
    assert.ok(names.includes(join(".agentbay", "kernel.db")), names.join(", "));
    assert.ok(names.includes(join(".agentbay", "data", "keeper--notes.db")), names.join(", "));
    assert.ok(
      names.some((name) => name.endsWith("-wal")),
      names.join(", "),
    );
    assertOwnerOnly(entries);
  } finally {
    kernel.close();
    await project.remove();
  }
});

test("a folder or database file left wider than owner-only is narrowed when the kernel next uses it", async () => {
  const project = await projectWithKeeper();
  const first = await openKernel(project);
  await kept(first);
  for (const entry of await entriesOf(project.root)) {
    await chmod(join(project.root, entry.path), entry.path.includes(".db") ? 0o644 : 0o755);
  }
  const widened = await entriesOf(project.root);
  assert.ok(widened.every((entry) => (entry.mode & 0o044) !== 0));
  first.close();
  const kernel = await openKernel(project);
  try {
    await kept(kernel);
    assertOwnerOnly(await entriesOf(project.root));
  } finally {
    kernel.close();
    await project.remove();
  }
});

test("a database file and its side files left wider than owner-only are narrowed by a run that only migrates", async () => {
  const project = await projectWithKeeper();
  const first = await openKernel(project);
  await kept(first);
  first.close();
  for (const entry of await entriesOf(project.root)) {
    await chmod(join(project.root, entry.path), entry.path.includes(".db") ? 0o644 : 0o755);
  }
  const kernel = await openKernel(project);
  try {
    await kept(kernel, "keeper.prepare");
    const partition = (await entriesOf(project.root)).filter((entry) => entry.path.includes("keeper--notes.db"));
    assert.ok(
      partition.some((entry) => entry.path.endsWith("-wal")),
      JSON.stringify(partition),
    );
    assertOwnerOnly(partition);
  } finally {
    kernel.close();
    await project.remove();
  }
});
