import assert from "node:assert/strict";
import { mkdir, readdir, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Answer } from "../bay/answers.ts";
import { Broker } from "../bay/broker.ts";
import { nodeChildProcesses, nodeFileInspector, nodeFileSystem, systemClock } from "../bay/node-ports.ts";
import { SecretStore } from "../bay/secrets.ts";
import {
  noProcesses,
  permissionsIn,
  place,
  recordingSink,
  scriptedHttp,
  withProject,
  writeProjectFile,
} from "./broker-fixture.ts";

type Setup = { readonly root: string; readonly broker: Broker; readonly events: ReturnType<typeof recordingSink> };

async function withFilesBroker(run: (setup: Setup) => Promise<void>): Promise<void> {
  await withProject(async (root) => {
    await writeProjectFile(root, "components/modes/notes/templates/day.md", "template");
    await writeProjectFile(root, "notes-in/today.md", "today");
    await writeProjectFile(root, "outside/secret.txt", "made-up outside text");
    await mkdir(join(root, "notes-out"), { recursive: true });
    const events = recordingSink();
    const broker = new Broker({
      root,
      permissions: permissionsIn(root),
      place,
      files: nodeFileSystem,
      inspector: nodeFileInspector,
      http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
      secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
      events,
      clock: systemClock,
      childProcesses: nodeChildProcesses,
    });
    try {
      await run({ root, broker, events });
    } finally {
      broker.close();
    }
  });
}

function refusalOf<T>(answer: Answer<T>): string {
  assert.equal(answer.ok, false, "expected a refusal");
  assert.equal(answer.ok ? "" : answer.kind, "refused");
  return answer.ok ? "" : answer.message;
}

test("files inside the read paths can be read, by project path or absolute path", async () => {
  await withFilesBroker(async ({ root, broker }) => {
    assert.deepEqual(await broker.readFile("notes-in/today.md"), { ok: true, value: "today" });
    assert.deepEqual(await broker.readFile(join(root, "components/modes/notes/templates/day.md")), {
      ok: true,
      value: "template",
    });
    assert.deepEqual(await broker.listFiles("components/modes/notes"), { ok: true, value: ["templates"] });
  });
});

test("a read outside the read paths is refused, naming resources.files.read", async () => {
  await withFilesBroker(async ({ broker, events }) => {
    const message = refusalOf(await broker.readFile("outside/secret.txt"));
    assert.match(message, /asked to read .*outside\/secret\.txt/);
    assert.match(message, /resources\.files\.read in .*components\/modes\/notes\/mode\.yaml/);
    refusalOf(await broker.readFile("notes-in/../outside/secret.txt"));
    refusalOf(await broker.readFile("/etc/passwd"));
    refusalOf(await broker.listFiles("outside"));
    refusalOf(await broker.listFiles("."));
    assert.equal(events.events.filter((event) => event.kind === "refused").length, 5);
  });
});

test("a read through a link inside a read path that points outside is refused", async () => {
  await withFilesBroker(async ({ root, broker }) => {
    await symlink(join(root, "outside/secret.txt"), join(root, "notes-in/link.md"));
    await symlink(join(root, "outside"), join(root, "notes-in/folder-link"));
    const message = refusalOf(await broker.readFile("notes-in/link.md"));
    assert.match(message, /link/);
    refusalOf(await broker.readFile("notes-in/folder-link/secret.txt"));
    refusalOf(await broker.listFiles("notes-in/folder-link"));
  });
});

test("a write inside the write paths is atomic, and makes missing folders", async () => {
  await withFilesBroker(async ({ root, broker }) => {
    assert.deepEqual(await broker.writeFile("notes-out/day/one.md", "first"), { ok: true, value: null });
    assert.deepEqual(await broker.writeFile("notes-out/day/one.md", "second"), { ok: true, value: null });
    assert.equal(await readFile(join(root, "notes-out/day/one.md"), "utf8"), "second");
    assert.deepEqual(await readdir(join(root, "notes-out/day")), ["one.md"]);
    assert.deepEqual(await broker.readFile("notes-out/day/one.md"), { ok: true, value: "second" });
  });
});

test("a write outside the write paths is refused, even inside a read path", async () => {
  await withFilesBroker(async ({ broker }) => {
    const message = refusalOf(await broker.writeFile("notes-in/today.md", "changed"));
    assert.match(message, /resources\.files\.write/);
    refusalOf(await broker.writeFile("outside/new.txt", "x"));
    refusalOf(await broker.writeFile("notes-out/../outside/new.txt", "x"));
    refusalOf(await broker.writeFile(".agentbay/data/notes.db", "x"));
  });
});

test("a write path with a linked component is refused, even when the link stays inside", async () => {
  await withFilesBroker(async ({ root, broker }) => {
    await symlink(join(root, "outside"), join(root, "notes-out/away"));
    await mkdir(join(root, "notes-out/real"));
    await symlink(join(root, "notes-out/real"), join(root, "notes-out/inside-link"));
    refusalOf(await broker.writeFile("notes-out/away/new.txt", "x"));
    refusalOf(await broker.writeFile("notes-out/inside-link/new.txt", "x"));
    await writeProjectFile(root, "outside/target.txt", "kept");
    await symlink(join(root, "outside/target.txt"), join(root, "notes-out/file-link.txt"));
    refusalOf(await broker.writeFile("notes-out/file-link.txt", "x"));
    assert.equal(await readFile(join(root, "outside/target.txt"), "utf8"), "kept");
  });
});

test("reading a missing file fails plainly", async () => {
  await withFilesBroker(async ({ broker }) => {
    const answer = await broker.readFile("notes-in/missing.md");
    assert.equal(answer.ok ? "" : answer.kind, "failed");
    assert.match(answer.ok ? "" : answer.message, /does not exist/);
  });
});
