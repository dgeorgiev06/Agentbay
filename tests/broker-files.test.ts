import assert from "node:assert/strict";
import { mkdir, readdir, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { noInterfaceSchemas } from "./broker-fixture.ts";
import type { Answer } from "../bay/answers.ts";
import { createBroker, type StepBroker } from "../bay/broker/broker.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeThrowawayFolders,
  systemClock,
} from "../bay/node-ports.ts";
import { SecretStore } from "../bay/secrets.ts";
import {
  noProcesses,
  permissionsIn,
  place,
  recordingSink,
  refusalOf as refusal,
  failureOf,
  scriptedHttp,
  withProject,
  writeProjectFile,
  projectLayout,
} from "./broker-fixture.ts";

type Setup = { readonly root: string; readonly broker: StepBroker; readonly events: ReturnType<typeof recordingSink> };

async function withFilesBroker(run: (setup: Setup) => Promise<void>): Promise<void> {
  await withProject(async (root) => {
    await writeProjectFile(root, "components/modes/notes/templates/day.md", "template");
    await writeProjectFile(root, "notes-in/today.md", "today");
    await writeProjectFile(root, "outside/secret.txt", "made-up outside text");
    await mkdir(join(root, "notes-out"), { recursive: true });
    const events = recordingSink();
    const broker = createBroker({
      layout: projectLayout(root),
      files: nodeFileSystem,
      throwawayFolders: nodeThrowawayFolders,
      inspector: nodeFileInspector,
      http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
      secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
      events,
      clock: systemClock,
      childProcesses: nodeChildProcesses,
      processes: noProcesses,
      commandSearchPath: "/usr/bin:/bin",
      interfaceSchemas: noInterfaceSchemas,
    }).forStep(place, permissionsIn(root, { effects: ["read", "write"] }));
    try {
      await run({ root, broker, events });
    } finally {
      broker.close();
    }
  });
}

function refusalOf<T>(answer: Answer<T>): string {
  return refusal(answer).message;
}

test("files inside the read paths can be read, by project path or absolute path", async () => {
  await withFilesBroker(async ({ root, broker }) => {
    assert.deepEqual(await broker.ask("files.read", { path: "notes-in/today.md" }), { ok: true, value: "today" });
    assert.deepEqual(await broker.ask("files.read", { path: join(root, "components/modes/notes/templates/day.md") }), {
      ok: true,
      value: "template",
    });
    assert.deepEqual(await broker.ask("files.list", { path: "components/modes/notes" }), {
      ok: true,
      value: ["templates"],
    });
  });
});

test("a read outside the read paths is refused, naming resources.files.read", async () => {
  await withFilesBroker(async ({ broker, events }) => {
    const message = refusalOf(await broker.ask("files.read", { path: "outside/secret.txt" }));
    assert.match(message, /asked to read .*outside\/secret\.txt/);
    assert.match(message, /resources\.files\.read in .*components\/modes\/notes\/mode\.yaml/);
    refusalOf(await broker.ask("files.read", { path: "notes-in/../outside/secret.txt" }));
    refusalOf(await broker.ask("files.read", { path: "/etc/passwd" }));
    refusalOf(await broker.ask("files.list", { path: "outside" }));
    refusalOf(await broker.ask("files.list", { path: "." }));
    assert.equal(events.events.filter((event) => event.kind === "refused").length, 5);
  });
});

test("a read through a link inside a read path that points outside is refused", async () => {
  await withFilesBroker(async ({ root, broker }) => {
    await symlink(join(root, "outside/secret.txt"), join(root, "notes-in/link.md"));
    await symlink(join(root, "outside"), join(root, "notes-in/folder-link"));
    const message = refusalOf(await broker.ask("files.read", { path: "notes-in/link.md" }));
    assert.match(message, /link/);
    refusalOf(await broker.ask("files.read", { path: "notes-in/folder-link/secret.txt" }));
    refusalOf(await broker.ask("files.list", { path: "notes-in/folder-link" }));
  });
});

test("a write inside the write paths is atomic, and makes missing folders", async () => {
  await withFilesBroker(async ({ root, broker }) => {
    assert.deepEqual(await broker.ask("files.write", { path: "notes-out/day/one.md", text: "first" }), {
      ok: true,
      value: null,
    });
    assert.deepEqual(await broker.ask("files.write", { path: "notes-out/day/one.md", text: "second" }), {
      ok: true,
      value: null,
    });
    assert.equal(await readFile(join(root, "notes-out/day/one.md"), "utf8"), "second");
    assert.deepEqual(await readdir(join(root, "notes-out/day")), ["one.md"]);
    assert.deepEqual(await broker.ask("files.read", { path: "notes-out/day/one.md" }), {
      ok: true,
      value: "second",
    });
  });
});

test("a write outside the write paths is refused, even inside a read path", async () => {
  await withFilesBroker(async ({ broker }) => {
    const message = refusalOf(await broker.ask("files.write", { path: "notes-in/today.md", text: "changed" }));
    assert.match(message, /resources\.files\.write/);
    refusalOf(await broker.ask("files.write", { path: "outside/new.txt", text: "x" }));
    refusalOf(await broker.ask("files.write", { path: "notes-out/../outside/new.txt", text: "x" }));
    refusalOf(await broker.ask("files.write", { path: ".agentbay/data/notes.db", text: "x" }));
  });
});

test("a write path with a linked component is refused, even when the link stays inside", async () => {
  await withFilesBroker(async ({ root, broker }) => {
    await symlink(join(root, "outside"), join(root, "notes-out/away"));
    await mkdir(join(root, "notes-out/real"));
    await symlink(join(root, "notes-out/real"), join(root, "notes-out/inside-link"));
    refusalOf(await broker.ask("files.write", { path: "notes-out/away/new.txt", text: "x" }));
    refusalOf(await broker.ask("files.write", { path: "notes-out/inside-link/new.txt", text: "x" }));
    await writeProjectFile(root, "outside/target.txt", "kept");
    await symlink(join(root, "outside/target.txt"), join(root, "notes-out/file-link.txt"));
    refusalOf(await broker.ask("files.write", { path: "notes-out/file-link.txt", text: "x" }));
    assert.equal(await readFile(join(root, "outside/target.txt"), "utf8"), "kept");
  });
});

test("reading a missing file fails plainly", async () => {
  await withFilesBroker(async ({ broker }) => {
    assert.match(failureOf(await broker.ask("files.read", { path: "notes-in/missing.md" })).message, /does not exist/);
  });
});

test("a granted path that is itself a link to another folder of the project is refused", async () => {
  await withProject(async (root) => {
    await writeProjectFile(root, ".agentbay/data/store.db", "made-up database bytes");
    await symlink(join(root, ".agentbay/data"), join(root, "notes-in"));
    const broker = createBroker({
      layout: projectLayout(root),
      files: nodeFileSystem,
      throwawayFolders: nodeThrowawayFolders,
      inspector: nodeFileInspector,
      http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
      secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
      events: recordingSink(),
      clock: systemClock,
      childProcesses: nodeChildProcesses,
      processes: noProcesses,
      commandSearchPath: "/usr/bin:/bin",
      interfaceSchemas: noInterfaceSchemas,
    }).forStep(place, permissionsIn(root));
    try {
      assert.match(refusalOf(await broker.ask("files.read", { path: "notes-in/store.db" })), /link/);
      refusalOf(await broker.ask("files.list", { path: "notes-in" }));
    } finally {
      broker.close();
    }
  });
});

test("the broker gives the kernel a script runner and a broker for a step, which only asks and closes", async () => {
  await withFilesBroker(({ broker }) => {
    assert.deepEqual(Object.keys(broker).sort(), ["ask", "close"]);
    return Promise.resolve();
  });
  const broker = createBroker({
    layout: projectLayout("/project"),
    files: nodeFileSystem,
    throwawayFolders: nodeThrowawayFolders,
    inspector: nodeFileInspector,
    http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
    secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
    events: recordingSink(),
    clock: systemClock,
    childProcesses: nodeChildProcesses,
    processes: noProcesses,
    commandSearchPath: "/usr/bin:/bin",
    interfaceSchemas: noInterfaceSchemas,
  });
  assert.deepEqual(Object.keys(broker).sort(), ["forStep", "scripts"]);
  assert.deepEqual(Object.keys(broker.scripts), ["run"]);
});
