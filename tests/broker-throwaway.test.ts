import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Answer } from "../bay/answers.ts";
import { createBroker, type StepBroker } from "../bay/broker/broker.ts";
import type { Effect } from "../bay/contracts.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeThrowawayFolders,
  systemClock,
} from "../bay/node-ports.ts";
import { SecretStore } from "../bay/secrets.ts";
import {
  failureOf,
  noProcesses,
  permissionsIn,
  place,
  projectLayout,
  recordingSink,
  type RecordingSink,
  refusalOf,
  scriptedHttp,
  withProject,
  writeProjectFile,
} from "./broker-fixture.ts";

type Setup = { readonly root: string; readonly broker: StepBroker; readonly events: RecordingSink };

const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

async function withThrowawayBroker(effects: readonly Effect[], run: (setup: Setup) => Promise<void>): Promise<void> {
  await withProject(async (root) => {
    await writeProjectFile(root, "shared/kept.txt", "kept");
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
    }).forStep(place, permissionsIn(root, { effects, throwawayPaths: [join(root, "scratch/copies")] }));
    try {
      await run({ root, broker, events });
    } finally {
      broker.close();
    }
  });
}

function messageOf<T>(answer: Answer<T>): string {
  return refusalOf(answer).message;
}

async function kindOf(path: string): Promise<string> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) {
      return "link";
    }
    return entry.isDirectory() ? "folder" : "file";
  } catch {
    return "missing";
  }
}

const manifest = "components/modes/notes/mode.yaml";

test("a folder is made inside a throwaway folder, with the folders above it", async () => {
  await withThrowawayBroker(everyEffect, async ({ root, broker }) => {
    assert.deepEqual(await broker.ask("files.makeFolder", { path: "scratch/copies/one" }), {
      ok: true,
      value: null,
    });
    assert.equal(await kindOf(join(root, "scratch/copies/one")), "folder");
  });
});

test("a folder that already exists is not made again", async () => {
  await withThrowawayBroker(everyEffect, async ({ broker }) => {
    await broker.ask("files.makeFolder", { path: "scratch/copies/one" });
    assert.equal(
      failureOf(await broker.ask("files.makeFolder", { path: "scratch/copies/one" })).message,
      "The folder scratch/copies/one already exists.",
    );
  });
});

test("a link is made inside a throwaway folder to a path of the project", async () => {
  await withThrowawayBroker(everyEffect, async ({ root, broker }) => {
    await broker.ask("files.makeFolder", { path: "scratch/copies/one" });
    assert.deepEqual(await broker.ask("files.link", { path: "scratch/copies/one/shared", target: "shared" }), {
      ok: true,
      value: null,
    });
    assert.equal(await kindOf(join(root, "scratch/copies/one/shared")), "link");
    assert.equal(await readlink(join(root, "scratch/copies/one/shared")), join(root, "shared"));
    assert.equal(await readFile(join(root, "scratch/copies/one/shared/kept.txt"), "utf8"), "kept");
  });
});

test("a link whose place is taken is not made", async () => {
  await withThrowawayBroker(everyEffect, async ({ broker }) => {
    await broker.ask("files.makeFolder", { path: "scratch/copies/one/shared" });
    assert.equal(
      failureOf(await broker.ask("files.link", { path: "scratch/copies/one/shared", target: "shared" })).message,
      "The path scratch/copies/one/shared already exists.",
    );
  });
});

test("a link to a path outside the project or inside .agentbay/ is refused", async () => {
  await withThrowawayBroker(everyEffect, async ({ root, broker }) => {
    await broker.ask("files.makeFolder", { path: "scratch/copies/one" });
    assert.deepEqual(
      [
        messageOf(await broker.ask("files.link", { path: "scratch/copies/one/up", target: ".." })),
        messageOf(await broker.ask("files.link", { path: "scratch/copies/one/state", target: ".agentbay/data" })),
      ],
      [
        `The step look.0 asked to link scratch/copies/one/up to ${join(root, "..")}, ` +
          "but a link may lead only to a path of the project outside .agentbay/. " +
          "Link to a file or folder of the project instead.",
        "The step look.0 asked to link scratch/copies/one/state to .agentbay/data, " +
          "but a link may lead only to a path of the project outside .agentbay/. " +
          "Link to a file or folder of the project instead.",
      ],
    );
    assert.equal(await kindOf(join(root, "scratch/copies/one/up")), "missing");
    assert.equal(await kindOf(join(root, "scratch/copies/one/state")), "missing");
  });
});

test("a folder with files, folders and links is removed, and what a link leads to is kept", async () => {
  await withThrowawayBroker(everyEffect, async ({ root, broker }) => {
    await broker.ask("files.makeFolder", { path: "scratch/copies/one" });
    await writeProjectFile(root, "scratch/copies/one/deep/file.txt", "copied");
    await broker.ask("files.link", { path: "scratch/copies/one/shared", target: "shared" });
    assert.deepEqual(await broker.ask("files.remove", { path: "scratch/copies/one" }), { ok: true, value: null });
    assert.equal(await kindOf(join(root, "scratch/copies/one")), "missing");
    assert.equal(await kindOf(join(root, "scratch/copies")), "folder");
    assert.equal(await readFile(join(root, "shared/kept.txt"), "utf8"), "kept");
  });
});

test("removing a path that does not exist answers that it is gone", async () => {
  await withThrowawayBroker(everyEffect, async ({ broker }) => {
    assert.deepEqual(await broker.ask("files.remove", { path: "scratch/copies/never-made" }), {
      ok: true,
      value: null,
    });
  });
});

test("a link inside a throwaway folder is removed itself, not what it leads to", async () => {
  await withThrowawayBroker(everyEffect, async ({ root, broker }) => {
    await broker.ask("files.makeFolder", { path: "scratch/copies/one" });
    await broker.ask("files.link", { path: "scratch/copies/one/shared", target: "shared" });
    assert.deepEqual(await broker.ask("files.remove", { path: "scratch/copies/one/shared" }), {
      ok: true,
      value: null,
    });
    assert.equal(await kindOf(join(root, "scratch/copies/one/shared")), "missing");
    assert.equal(await readFile(join(root, "shared/kept.txt"), "utf8"), "kept");
  });
});

function outsideSentence(root: string, asked: string): string {
  return (
    `The step look.0 asked to ${asked}, but the mode notes keeps throwaway folders only in: scratch/copies, ` +
    "and never removes one of them whole. To allow it, name a folder that holds the path under " +
    `resources.files.throwaway in ${join(root, manifest)}.`
  );
}

test("a path outside the throwaway folders, or a throwaway folder itself, is refused", async () => {
  await withThrowawayBroker(everyEffect, async ({ root, broker }) => {
    assert.deepEqual(
      [
        messageOf(await broker.ask("files.makeFolder", { path: "notes-out/one" })),
        messageOf(await broker.ask("files.link", { path: "shared/again", target: "shared" })),
        messageOf(await broker.ask("files.remove", { path: "shared" })),
        messageOf(await broker.ask("files.remove", { path: "scratch/copies" })),
        messageOf(await broker.ask("files.makeFolder", { path: "scratch/copies" })),
        messageOf(await broker.ask("files.remove", { path: "scratch/copies/../../shared" })),
      ],
      [
        outsideSentence(root, "make the folder notes-out/one"),
        outsideSentence(root, "link shared/again to shared"),
        outsideSentence(root, "remove shared"),
        outsideSentence(root, "remove scratch/copies"),
        outsideSentence(root, "make the folder scratch/copies"),
        outsideSentence(root, "remove shared"),
      ],
    );
    assert.equal(await readFile(join(root, "shared/kept.txt"), "utf8"), "kept");
  });
});

test("a throwaway folder reached through a link is refused", async () => {
  await withThrowawayBroker(everyEffect, async ({ root, broker }) => {
    await mkdir(join(root, "scratch"), { recursive: true });
    await symlink(join(root, "shared"), join(root, "scratch/copies"));
    assert.equal(
      messageOf(await broker.ask("files.remove", { path: "scratch/copies/kept.txt" })),
      "The step look.0 asked to remove scratch/copies/kept.txt, but a link on that path leads to " +
        `${join(root, "shared")}, outside the throwaway folders. ` +
        "Remove the link: the broker makes and removes nothing through a link.",
    );
    assert.equal(await readFile(join(root, "shared/kept.txt"), "utf8"), "kept");
  });
});

test("a folder is not made where a link already stands, even one that stays inside", async () => {
  await withThrowawayBroker(everyEffect, async ({ root, broker }) => {
    await mkdir(join(root, "scratch/copies/other"), { recursive: true });
    await symlink(join(root, "scratch/copies/other"), join(root, "scratch/copies/one"));
    assert.equal(
      messageOf(await broker.ask("files.makeFolder", { path: "scratch/copies/one" })),
      "The step look.0 asked to make the folder scratch/copies/one, but one on that path is a link, " +
        "and the broker makes and removes nothing through a link. " +
        `Replace the link ${join(root, "scratch/copies/one")} with a real folder.`,
    );
  });
});

test("making a folder or a link needs the write effect, and removing needs the delete effect too", async () => {
  await withThrowawayBroker(["read", "write"], async ({ root, broker }) => {
    await broker.ask("files.makeFolder", { path: "scratch/copies/one" });
    assert.equal(
      messageOf(await broker.ask("files.remove", { path: "scratch/copies/one" })),
      "The step look.0 of action look asked to remove scratch/copies/one, but the action look declares the " +
        "effects: read, write. Removing a file or folder needs the delete effect; to allow it, add delete to " +
        `actions.look.effects in ${join(root, manifest)}.`,
    );
    assert.equal(await kindOf(join(root, "scratch/copies/one")), "folder");
  });
  await withThrowawayBroker(["read"], async ({ root, broker }) => {
    const declared =
      "but the action look declares the effects: read. Writing a file needs the write effect; " +
      `to allow it, add write to actions.look.effects in ${join(root, manifest)}.`;
    assert.deepEqual(
      [
        messageOf(await broker.ask("files.makeFolder", { path: "scratch/copies/one" })),
        messageOf(await broker.ask("files.link", { path: "scratch/copies/l", target: "x" })),
      ],
      [
        `The step look.0 of action look asked to make the folder scratch/copies/one, ${declared}`,
        `The step look.0 of action look asked to link scratch/copies/l to x, ${declared}`,
      ],
    );
  });
});

test("each folder made, link made and path removed is recorded as an event of the run", async () => {
  await withThrowawayBroker(everyEffect, async ({ broker, events }) => {
    await broker.ask("files.makeFolder", { path: "scratch/copies/one" });
    await broker.ask("files.link", { path: "scratch/copies/one/shared", target: "shared" });
    await broker.ask("files.remove", { path: "scratch/copies/one" });
    assert.deepEqual(
      events.events.filter((event) => event.kind === "throwaway").map((event) => event.detail),
      [
        { step: "look.0", did: "made the folder", path: "scratch/copies/one" },
        { step: "look.0", did: "made a link", path: "scratch/copies/one/shared", target: "shared" },
        { step: "look.0", did: "removed", path: "scratch/copies/one" },
      ],
    );
  });
});
