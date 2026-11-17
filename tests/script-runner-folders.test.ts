import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import type { Json, Permissions, StepOutcome } from "../bay/contracts.ts";
import { layoutOf, type Layout } from "../bay/layout.ts";
import { nodeChildProcesses, nodeFileInspector, nodeFileSystem, systemClock } from "../bay/node-ports.ts";
import { createScriptRunner } from "../bay/script-runner.ts";
import { SecretStore } from "../bay/secrets.ts";
import { kitFolder, noProcesses, place, recordingSink, scriptedHttp, writeProjectFile } from "./broker-fixture.ts";
import { grantsWith } from "./grants-fixture.ts";

type Folders = { readonly layout: Layout };

async function withSeparateFolders(body: (folders: Folders) => Promise<void>): Promise<void> {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "agentbay-k7-runner-")));
  const kit = join(scratch, "kit");
  const project = join(scratch, "project");
  try {
    await mkdir(kit, { recursive: true });
    await mkdir(join(project, "notes-out"), { recursive: true });
    await body({ layout: layoutOf({ kit, project }) });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function permissionsOf(layout: Layout, modeFolder: string): Permissions {
  const writable = join(layout.project, "notes-out");
  const grants = grantsWith({
    mode: "notes",
    modeFolder,
    databaseFile: join(layout.project, ".agentbay", "data", "notes.db"),
    migrationsFolder: join(modeFolder, "migrations"),
    readPaths: [modeFolder, writable],
    writePaths: [writable],
  });
  return { grants, actionEffects: ["read", "write"] };
}

async function run(layout: Layout, modeFolder: string): Promise<StepOutcome> {
  const runner = createScriptRunner({
    layout,
    files: nodeFileSystem,
    inspector: nodeFileInspector,
    http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
    secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
    events: recordingSink(),
    clock: systemClock,
    childProcesses: nodeChildProcesses,
    processes: noProcesses,
    commandSearchPath: "/usr/bin:/bin",
  });
  return runner.run({
    place,
    script: "scripts/probe.ts",
    input: { name: "Ada" },
    permissions: permissionsOf(layout, modeFolder),
    settings: {},
    remaining: {},
    timeLimitMilliseconds: 30_000,
    call: () =>
      Promise.resolve({ status: "failed", reason: "no calls", spent: { items: 0, usd: 0, tokens: 0, minutes: 0 } }),
  });
}

function outputOf(outcome: StepOutcome): Json {
  if (outcome.status === "failed") {
    assert.fail(`expected done, got failed: ${outcome.reason}`);
  }
  return outcome.output;
}

test("a project mode's script imports the SDK as agentbay/sdk and runs with the kit elsewhere on disk", async () => {
  await withSeparateFolders(async ({ layout }) => {
    const modeFolder = join(layout.project, "components", "modes", "notes");
    await writeProjectFile(
      modeFolder,
      "scripts/probe.ts",
      [
        'import { defineScript, fail } from "agentbay/sdk";',
        "export const run = defineScript(async (input, context) => {",
        '  const written = await context.files.write("notes-out/greeting.md", "hello");',
        '  return written.ok ? { got: input, kit: "elsewhere" } : fail(written.message);',
        "});",
        "",
      ].join("\n"),
    );
    assert.deepEqual(outputOf(await run(layout, modeFolder)), { got: { name: "Ada" }, kit: "elsewhere" });
    assert.equal(await readFile(join(layout.project, "notes-out", "greeting.md"), "utf8"), "hello");
  });
});

test("a project mode's script cannot reach the kit's other files by a relative or absolute path", async () => {
  await withSeparateFolders(async ({ layout }) => {
    const modeFolder = join(layout.project, "components", "modes", "notes");
    await writeProjectFile(
      modeFolder,
      "scripts/probe.ts",
      [
        'import { defineScript } from "agentbay/sdk";',
        'import { readFileSync } from "node:fs";',
        "export const run = defineScript(async () => {",
        "  try {",
        `    readFileSync(${JSON.stringify(join(kitFolder, "bay", "kernel.ts"))}, "utf8");`,
        '    return { read: "the kernel" };',
        "  } catch (error) {",
        '    return { refused: String(error instanceof Error && "code" in error ? error.code : error) };',
        "  }",
        "});",
        "",
      ].join("\n"),
    );
    assert.deepEqual(outputOf(await run(layout, modeFolder)), { refused: "ERR_ACCESS_DENIED" });
  });
});

test("a kit mode's script imports the SDK by a relative path, reads its own folder and writes only project paths", async () => {
  await withSeparateFolders(async ({ layout }) => {
    const modeFolder = join(layout.kit, "components", "modes", "notes");
    const sdk = relative(join(modeFolder, "scripts"), join(kitFolder, "bay", "sdk.ts"));
    await writeProjectFile(modeFolder, "templates/day.md", "the day template");
    await writeProjectFile(
      modeFolder,
      "scripts/probe.ts",
      [
        `import { defineScript, fail } from ${JSON.stringify(sdk)};`,
        'import { readFileSync, writeFileSync } from "node:fs";',
        "export const run = defineScript(async (_input, context) => {",
        '  const own = readFileSync(new URL("../templates/day.md", import.meta.url), "utf8");',
        `  const throughBroker = await context.files.read(${JSON.stringify(join(modeFolder, "templates", "day.md"))});`,
        '  const written = await context.files.write("notes-out/day.md", own);',
        '  let ownWrite = "allowed";',
        "  try {",
        '    writeFileSync(new URL("../templates/changed.md", import.meta.url), "x");',
        "  } catch (error) {",
        '    ownWrite = String(error instanceof Error && "code" in error ? error.code : error);',
        "  }",
        "  if (!written.ok || !throughBroker.ok) {",
        '    return fail(`${written.ok ? "" : written.message} ${throughBroker.ok ? "" : throughBroker.message}`);',
        "  }",
        "  return { own, throughBroker: throughBroker.value, ownWrite };",
        "});",
        "",
      ].join("\n"),
    );
    assert.deepEqual(outputOf(await run(layout, modeFolder)), {
      own: "the day template",
      throughBroker: "the day template",
      ownWrite: "ERR_ACCESS_DENIED",
    });
    assert.equal(await readFile(join(layout.project, "notes-out", "day.md"), "utf8"), "the day template");
  });
});
