import assert from "node:assert/strict";
import { lstat, readdir, readFile, readlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Answer } from "../../../bay/answers.ts";
import { openStep, type OpenStep } from "../../../bay/broker/step-broker.ts";
import type { ActionCaller, Effect, Json, ModeGrants } from "../../../bay/contracts.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeThrowawayFolders,
} from "../../../bay/node-ports.ts";
import type { HttpRequest, HttpResponse } from "../../../bay/ports.ts";
import { SecretStore } from "../../../bay/secrets.ts";
import { fakeClock } from "../../fakes.ts";
import { grantedCommand } from "../../grants-fixture.ts";
import {
  exitedProcess,
  noProcesses,
  permissionsIn,
  place,
  projectLayout,
  recordingProcesses,
  recordingSink,
  scriptedHttp,
  withProject,
  writeProjectFile,
} from "../../broker-fixture.ts";

type Moved = keyof OpenStep["entries"];

type Asking = {
  readonly ask: (broker: OpenStep) => Promise<Answer<Json>>;
  readonly effects: readonly Effect[];
  readonly grants?: (root: string) => Partial<ModeGrants>;
  readonly call?: ActionCaller;
};

type Refusing = Asking & { readonly change: string; readonly detail?: { readonly [key: string]: Json } };

type Failing = Asking & { readonly message: string };

type Allowed = Asking & { readonly value: Json; readonly recorded: readonly Json[]; readonly spent?: Json };

type Two<T> = readonly [T, T];

type Proofs = {
  readonly [Name in Moved]: {
    readonly withoutEffect: Two<Refusing> | "needs no effect";
    readonly outsideGrant: Two<Refusing> | { readonly refusedByTheCaller: Two<Failing> };
    readonly allowed: Two<Allowed>;
  };
};

const secretValue = "made-up-token-for-proofs";

const secondSecretValue = "second-made-up-token-for-proofs";

const manifest = "<root>/components/modes/notes/mode.yaml";

const writeNeeded = `Writing a file needs the write effect; to allow it, add write to actions.look.effects in ${manifest}.`;

const deleteNeeded = `Removing a file or folder needs the delete effect; to allow it, add delete to actions.look.effects in ${manifest}.`;

const throwawayOnly = `To allow it, name a folder that holds the path under resources.files.throwaway in ${manifest}.`;

const changesData = `A statement that changes data needs the write effect; to allow it, add write to actions.look.effects in ${manifest}.`;

const deletesData = `A statement that deletes needs the delete effect; to allow it, add delete to actions.look.effects in ${manifest}.`;

const kebabPartition = "Name the partition with lowercase letters, digits and single dashes, such as feed-briefing.";

const plainSql = "No manifest line allows attach, detach, vacuum, pragma or transaction statements; use plain SQL.";

const migrationsOfTheMode = `Point resources.db.migrations in ${manifest} at a folder of the mode.`;

const networkNeeded = `A request over the network needs the network effect; to allow it, add network to actions.look.effects in ${manifest}.`;

const spendNeeded = `Spending more than nothing needs the spend effect; to allow it, add spend to actions.look.effects in ${manifest}.`;

const commandNeeds = (effect: Effect): string => `To allow it, add ${effect} to actions.look.effects in ${manifest}.`;

const brokerKinds = "Choose another kind for the event.";

const spendingShape = "Report spending as { items, usd, tokens } with numbers of at least 0.";

const projectFolderOnly =
  'Give a folder of the project in the call to context.commands.run, such as "."; no manifest line allows another.';

const allFive: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

const nothingSpent: Json = { items: 0, usd: 0, tokens: 0 };

const noSpend = { items: 0, usd: 0, tokens: 0, minutes: 0 };

const callerAnswering =
  (output: Json): ActionCaller =>
  () =>
    Promise.resolve({ status: "done", output, spent: noSpend });

const unbound = "The binding of notes does not allow items-store.put.";

const fine: HttpResponse = { status: 200, headers: {}, body: "fine" };

function answeredRequest(request: HttpRequest): HttpResponse {
  if (request.url === "https://api.example.com/start") {
    return { status: 302, headers: { location: "/next" }, body: "" };
  }
  return fine;
}

function get(url: string, headers: Readonly<Record<string, string>> = {}): HttpRequest {
  return { method: "GET", url, headers };
}

const exited = { how: "exited", exitCode: 0 } as const;

const nodeVersion = ["node", "--version"];

const version = { name: "version", arguments: [] };

const echoingCode = "process.stdin.pipe(process.stdout)";

const echoing = ["node", "-e", echoingCode];

const helloHash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

const outsideMigrations = (root: string): Partial<ModeGrants> => ({
  migrationsFolder: join(root, "components/base/store/migrations"),
});

const every: readonly Effect[] = ["read", "write", "delete"];

const writing: readonly Effect[] = ["read", "write"];

const throwaway = (did: string, path: string): Json => ({ kind: "throwaway", detail: { step: "look.0", did, path } });

const proofs: Proofs = {
  "files.read": {
    withoutEffect: "needs no effect",
    outsideGrant: [
      {
        ask: (broker) => broker.entries["files.read"]({ path: "outside/secret.txt" }),
        effects: every,
        change: `To allow it, add outside/secret.txt under resources.files.read in ${manifest}.`,
      },
      {
        ask: (broker) => broker.entries["files.read"]({ path: "notes-in/escape.txt" }),
        effects: every,
        change: "Remove the link: a mode may not reach files through a link that leaves its folders.",
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["files.read"]({ path: "notes-in/today.md" }),
        effects: [],
        value: "today",
        recorded: [],
      },
      {
        ask: (broker) => broker.entries["files.read"]({ path: "notes-out/kept.txt" }),
        effects: [],
        value: "kept",
        recorded: [],
      },
    ],
  },
  "files.list": {
    withoutEffect: "needs no effect",
    outsideGrant: [
      {
        ask: (broker) => broker.entries["files.list"]({ path: "." }),
        effects: every,
        change: `To allow it, add . under resources.files.read in ${manifest}.`,
      },
      {
        ask: (broker) => broker.entries["files.list"]({ path: "outside" }),
        effects: every,
        change: `To allow it, add outside under resources.files.read in ${manifest}.`,
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["files.list"]({ path: "notes-in" }),
        effects: [],
        value: ["escape.txt", "today.md"],
        recorded: [],
      },
      {
        ask: (broker) => broker.entries["files.list"]({ path: "notes-out" }),
        effects: [],
        value: ["kept.txt"],
        recorded: [],
      },
    ],
  },
  "files.write": {
    withoutEffect: [
      {
        ask: (broker) => broker.entries["files.write"]({ path: "notes-out/a.txt", text: "x" }),
        effects: ["read"],
        change: writeNeeded,
      },
      {
        ask: (broker) => broker.entries["files.write"]({ path: "notes-out/kept.txt", text: "y" }),
        effects: [],
        change: writeNeeded,
      },
    ],
    outsideGrant: [
      {
        ask: (broker) => broker.entries["files.write"]({ path: "notes-in/today.md", text: "x" }),
        effects: every,
        change: `To allow it, add notes-in/today.md under resources.files.write in ${manifest}.`,
      },
      {
        ask: (broker) => broker.entries["files.write"]({ path: "outside/secret.txt", text: "x" }),
        effects: every,
        change: `To allow it, add outside/secret.txt under resources.files.write in ${manifest}.`,
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["files.write"]({ path: "notes-out/a.txt", text: "x" }),
        effects: writing,
        value: null,
        recorded: [],
      },
      {
        ask: (broker) => broker.entries["files.write"]({ path: "notes-out/b.txt", text: `token ${secretValue}` }),
        effects: writing,
        value: null,
        recorded: [
          {
            kind: "redacted",
            detail: {
              step: "look.0",
              file: "<root>/notes-out/b.txt",
              message: "A secret's value was removed from the text before the file was written.",
            },
          },
        ],
      },
    ],
  },
  "files.makeFolder": {
    withoutEffect: [
      {
        ask: (broker) => broker.entries["files.makeFolder"]({ path: "scratch/one" }),
        effects: ["read"],
        change: writeNeeded,
      },
      {
        ask: (broker) => broker.entries["files.makeFolder"]({ path: "scratch/two/inner" }),
        effects: ["read", "delete"],
        change: writeNeeded,
      },
    ],
    outsideGrant: [
      {
        ask: (broker) => broker.entries["files.makeFolder"]({ path: "notes-out/one" }),
        effects: every,
        change: throwawayOnly,
      },
      {
        ask: (broker) => broker.entries["files.makeFolder"]({ path: "scratch" }),
        effects: every,
        change: throwawayOnly,
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["files.makeFolder"]({ path: "scratch/one" }),
        effects: writing,
        value: null,
        recorded: [throwaway("made the folder", "scratch/one")],
      },
      {
        ask: (broker) => broker.entries["files.makeFolder"]({ path: "scratch/two/inner" }),
        effects: writing,
        value: null,
        recorded: [throwaway("made the folder", "scratch/two/inner")],
      },
    ],
  },
  "files.link": {
    withoutEffect: [
      {
        ask: (broker) => broker.entries["files.link"]({ path: "scratch/notes", target: "notes-in" }),
        effects: ["read"],
        change: writeNeeded,
      },
      {
        ask: (broker) => broker.entries["files.link"]({ path: "scratch/old/kept", target: "notes-out/kept.txt" }),
        effects: [],
        change: writeNeeded,
      },
    ],
    outsideGrant: [
      {
        ask: (broker) => broker.entries["files.link"]({ path: "notes-out/notes", target: "notes-in" }),
        effects: every,
        change: throwawayOnly,
      },
      {
        ask: (broker) => broker.entries["files.link"]({ path: "scratch/data", target: ".agentbay/data" }),
        effects: every,
        change: "Link to a file or folder of the project instead.",
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["files.link"]({ path: "scratch/notes", target: "notes-in" }),
        effects: writing,
        value: null,
        recorded: [
          {
            kind: "throwaway",
            detail: { step: "look.0", did: "made a link", path: "scratch/notes", target: "notes-in" },
          },
        ],
      },
      {
        ask: (broker) => broker.entries["files.link"]({ path: "scratch/old/kept", target: "notes-out/kept.txt" }),
        effects: writing,
        value: null,
        recorded: [
          {
            kind: "throwaway",
            detail: { step: "look.0", did: "made a link", path: "scratch/old/kept", target: "notes-out/kept.txt" },
          },
        ],
      },
    ],
  },
  "files.remove": {
    withoutEffect: [
      {
        ask: (broker) => broker.entries["files.remove"]({ path: "scratch/old" }),
        effects: ["read"],
        change: writeNeeded,
      },
      {
        ask: (broker) => broker.entries["files.remove"]({ path: "scratch/old/a.txt" }),
        effects: writing,
        change: deleteNeeded,
      },
    ],
    outsideGrant: [
      { ask: (broker) => broker.entries["files.remove"]({ path: "scratch" }), effects: every, change: throwawayOnly },
      {
        ask: (broker) => broker.entries["files.remove"]({ path: "notes-out/kept.txt" }),
        effects: every,
        change: throwawayOnly,
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["files.remove"]({ path: "scratch/old" }),
        effects: every,
        value: null,
        recorded: [throwaway("removed", "scratch/old")],
      },
      {
        ask: (broker) => broker.entries["files.remove"]({ path: "scratch/old/a.txt" }),
        effects: every,
        value: null,
        recorded: [throwaway("removed", "scratch/old/a.txt")],
      },
    ],
  },
  "db.execute": {
    withoutEffect: [
      {
        ask: (broker) => broker.entries["db.execute"]({ sql: "insert into notes (text) values ('a')", parameters: [] }),
        effects: ["read"],
        change: changesData,
      },
      {
        ask: (broker) => broker.entries["db.execute"]({ sql: "delete from notes", parameters: [] }),
        effects: writing,
        change: deletesData,
      },
    ],
    outsideGrant: [
      {
        ask: (broker) =>
          broker.entries["db.execute"]({
            sql: "insert into notes (text) values ('a')",
            parameters: [],
            partition: "Feed.Briefing",
          }),
        effects: every,
        change: kebabPartition,
      },
      {
        ask: (broker) => broker.entries["db.execute"]({ sql: "pragma journal_mode = delete", parameters: [] }),
        effects: every,
        change: plainSql,
      },
    ],
    allowed: [
      {
        ask: (broker) =>
          broker.entries["db.execute"]({ sql: "insert into notes (text) values (?)", parameters: ["a"] }),
        effects: writing,
        value: { changes: 1, lastInsertRowid: 1 },
        recorded: [],
      },
      {
        ask: (broker) =>
          broker.entries["db.execute"]({
            sql: "insert into notes (text) values (?)",
            parameters: [`token ${secretValue}`],
          }),
        effects: writing,
        value: { changes: 1, lastInsertRowid: 1 },
        recorded: [
          {
            kind: "redacted",
            detail: {
              step: "look.0",
              message: "Text that looks like a secret was removed from the values of a statement before it was stored.",
            },
          },
        ],
      },
    ],
  },
  "db.query": {
    withoutEffect: [
      {
        ask: (broker) => broker.entries["db.query"]({ sql: "insert into notes (text) values ('a')", parameters: [] }),
        effects: [],
        change: changesData,
      },
      {
        ask: (broker) =>
          broker.entries["db.query"]({ sql: "with gone as (select 1) delete from notes", parameters: [] }),
        effects: ["read"],
        change: changesData,
      },
    ],
    outsideGrant: [
      {
        ask: (broker) => broker.entries["db.query"]({ sql: "select 1", parameters: [], partition: "../other" }),
        effects: every,
        change: kebabPartition,
      },
      {
        ask: (broker) => broker.entries["db.query"]({ sql: "update notes set text = 'b'", parameters: [] }),
        effects: every,
        change: plainSql,
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["db.query"]({ sql: "select count(*) as n from notes", parameters: [] }),
        effects: [],
        value: [{ n: 0 }],
        recorded: [],
      },
      {
        ask: (broker) => broker.entries["db.query"]({ sql: "select 1 as one", parameters: [] }),
        effects: [],
        value: [{ one: 1 }],
        recorded: [],
      },
    ],
  },
  "db.migrate": {
    withoutEffect: "needs no effect",
    outsideGrant: [
      { ask: (broker) => broker.entries["db.migrate"]({ partition: "Alpha" }), effects: every, change: kebabPartition },
      {
        ask: (broker) => broker.entries["db.migrate"]({ partition: "alpha" }),
        effects: every,
        grants: outsideMigrations,
        change: migrationsOfTheMode,
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["db.migrate"]({ partition: "alpha" }),
        effects: [],
        value: ["0001-notes.sql"],
        recorded: [],
      },
      { ask: (broker) => broker.entries["db.migrate"]({}), effects: [], value: ["0001-notes.sql"], recorded: [] },
    ],
  },
  "db.agentQuery": {
    withoutEffect: "needs no effect",
    outsideGrant: [
      {
        ask: (broker) => broker.entries["db.agentQuery"]({ sql: "select 1", partition: "a".repeat(65) }),
        effects: every,
        change: kebabPartition,
      },
      {
        ask: (broker) => broker.entries["db.agentQuery"]({ sql: "select 1" }),
        effects: every,
        grants: outsideMigrations,
        change: migrationsOfTheMode,
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["db.agentQuery"]({ sql: "select count(*) as n from notes" }),
        effects: [],
        value: { columns: ["n"], rows: [[0]] },
        recorded: [],
      },
      {
        ask: (broker) => broker.entries["db.agentQuery"]({ sql: "select 1 as one" }),
        effects: [],
        value: { columns: ["one"], rows: [[1]] },
        recorded: [],
      },
    ],
  },
  "secrets.get": {
    withoutEffect: "needs no effect",
    outsideGrant: [
      {
        ask: (broker) => broker.entries["secrets.get"]({ name: "OTHER_TOKEN" }),
        effects: every,
        change: `To allow it, add OTHER_TOKEN under resources.secrets in ${manifest}.`,
      },
      {
        ask: (broker) => broker.entries["secrets.get"]({ name: "api_token" }),
        effects: every,
        change: `Rename the secret in resources.secrets in ${manifest} and where it is stored.`,
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["secrets.get"]({ name: "API_TOKEN" }),
        effects: [],
        value: secretValue,
        recorded: [],
      },
      {
        ask: (broker) => broker.entries["secrets.get"]({ name: "SECOND_TOKEN" }),
        effects: [],
        value: secondSecretValue,
        recorded: [],
      },
    ],
  },
  "http.request": {
    withoutEffect: [
      {
        ask: (broker) => broker.entries["http.request"](get("https://api.example.com/x")),
        effects: [],
        change: networkNeeded,
      },
      {
        ask: (broker) =>
          broker.entries["http.request"]({
            method: "POST",
            url: "https://api.example.com/x",
            headers: {},
            body: "payload",
          }),
        effects: writing,
        change: networkNeeded,
      },
    ],
    outsideGrant: [
      {
        ask: (broker) => broker.entries["http.request"](get("https://evil.example/collect")),
        effects: allFive,
        change: `To allow it, add evil.example under resources.network in ${manifest}.`,
      },
      {
        ask: (broker) => broker.entries["http.request"](get("http://api.example.com/x")),
        effects: allFive,
        change: "Use an https:// URL; no manifest line allows another scheme.",
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["http.request"](get("https://api.example.com/x")),
        effects: ["network"],
        value: fine,
        recorded: [
          {
            kind: "http",
            detail: { step: "look.0", method: "GET", url: "https://api.example.com/x", headers: {}, status: 200 },
          },
        ],
      },
      {
        ask: (broker) =>
          broker.entries["http.request"](
            get("https://api.example.com/start", { authorization: `Bearer ${secretValue}` }),
          ),
        effects: ["network"],
        value: fine,
        recorded: [
          {
            kind: "http",
            detail: {
              step: "look.0",
              method: "GET",
              url: "https://api.example.com/start",
              headers: { authorization: "[redacted]" },
              status: 302,
            },
          },
          {
            kind: "http",
            detail: {
              step: "look.0",
              method: "GET",
              url: "https://api.example.com/next",
              headers: { authorization: "[redacted]" },
              status: 200,
            },
          },
        ],
      },
    ],
  },
  "events.emit": {
    withoutEffect: "needs no effect",
    outsideGrant: [
      {
        ask: (broker) => broker.entries["events.emit"]({ kind: "refused", detail: { forged: true } }),
        effects: every,
        change: brokerKinds,
      },
      {
        ask: (broker) => broker.entries["events.emit"]({ kind: "http", detail: { url: "https://a.example" } }),
        effects: every,
        change: brokerKinds,
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["events.emit"]({ kind: "noted", detail: { day: "2026-11-17" } }),
        effects: [],
        value: null,
        recorded: [{ kind: "noted", detail: { day: "2026-11-17" } }],
      },
      {
        ask: (broker) =>
          broker.entries["events.emit"]({ kind: "synced", detail: { note: `token ${secretValue}`, count: 3 } }),
        effects: [],
        value: null,
        recorded: [{ kind: "synced", detail: { note: "token [redacted:API_TOKEN]", count: 3 } }],
      },
    ],
  },
  spend: {
    withoutEffect: [
      { ask: (broker) => broker.entries.spend({ spending: { usd: 0.5 } }), effects: [], change: spendNeeded },
      { ask: (broker) => broker.entries.spend({ spending: { items: 1 } }), effects: every, change: spendNeeded },
    ],
    outsideGrant: [
      { ask: (broker) => broker.entries.spend({ spending: { items: -1 } }), effects: allFive, change: spendingShape },
      { ask: (broker) => broker.entries.spend({ spending: { usd: "x" } }), effects: allFive, change: spendingShape },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries.spend({ spending: { usd: 0.5 } }),
        effects: ["spend"],
        value: null,
        recorded: [],
        spent: { items: 0, usd: 0.5, tokens: 0 },
      },
      {
        ask: (broker) => broker.entries.spend({ spending: { items: 2, tokens: 100 } }),
        effects: ["spend"],
        value: null,
        recorded: [],
        spent: { items: 2, usd: 0, tokens: 100 },
      },
    ],
  },
  call: {
    withoutEffect: "needs no effect",
    outsideGrant: {
      refusedByTheCaller: [
        {
          ask: (broker) => broker.entries.call({ reference: "items-store.put", input: { day: "2026-11-17" } }),
          effects: allFive,
          call: () => Promise.resolve({ status: "failed", reason: unbound, spent: noSpend }),
          message: unbound,
        },
        {
          ask: (broker) => broker.entries.call({ reference: "items-store.put", input: { day: "2026-11-17" } }),
          effects: allFive,
          call: () => Promise.reject(new Error(`broken with ${secretValue}`)),
          message: "The call to items-store.put stopped at an unexpected error: broken with [redacted:API_TOKEN]",
        },
      ],
    },
    allowed: [
      {
        ask: (broker) => broker.entries.call({ reference: "items-store.put", input: { day: "2026-11-17" } }),
        effects: [],
        call: callerAnswering({ stored: "2026-11-17" }),
        value: { stored: "2026-11-17" },
        recorded: [],
      },
      {
        ask: (broker) => broker.entries.call({ reference: "items-store.list", input: {} }),
        effects: [],
        call: callerAnswering([1, 2]),
        value: [1, 2],
        recorded: [],
      },
    ],
  },
  "commands.run": {
    withoutEffect: [
      {
        ask: (broker) => broker.entries["commands.run"]({ ...version, folder: ".", timeLimitSeconds: 30 }),
        effects: [],
        change: commandNeeds("read"),
        detail: { ...version, folder: "." },
      },
      {
        ask: (broker) => broker.entries["commands.run"]({ ...version, folder: ".", timeLimitSeconds: 30 }),
        effects: ["read", "write", "network", "spend"],
        change: commandNeeds("delete"),
        detail: { ...version, folder: "." },
      },
    ],
    outsideGrant: [
      {
        ask: (broker) =>
          broker.entries["commands.run"]({ name: "changes", arguments: [], folder: ".", timeLimitSeconds: 30 }),
        effects: allFive,
        change:
          `To allow it, list changes under resources.commands in ${manifest} with the words it runs and its ` +
          "effects; a mode outside the kit's components/base/ is granted the commands it lists only when the owner " +
          "trusts its list.",
        detail: { name: "changes", arguments: [], folder: "." },
      },
      {
        ask: (broker) => broker.entries["commands.run"]({ ...version, folder: "..", timeLimitSeconds: 30 }),
        effects: allFive,
        change: projectFolderOnly,
        detail: { ...version, folder: ".." },
      },
    ],
    allowed: [
      {
        ask: (broker) => broker.entries["commands.run"]({ ...version, folder: ".", timeLimitSeconds: 30 }),
        effects: allFive,
        value: {
          end: exited,
          milliseconds: 0,
          stdout: { text: "v1.0.0\n", cut: false },
          stderr: { text: "", cut: false },
        },
        recorded: [
          {
            kind: "command",
            detail: {
              step: "look.0",
              name: "version",
              command: nodeVersion,
              folder: ".",
              end: exited,
              milliseconds: 0,
              stdoutHash: "",
              stderrHash: "",
            },
          },
        ],
      },
      {
        ask: (broker) =>
          broker.entries["commands.run"]({
            name: "evaluate",
            arguments: [echoingCode],
            folder: "notes-in",
            timeLimitSeconds: 30,
            input: "hello",
          }),
        effects: allFive,
        value: {
          end: exited,
          milliseconds: 0,
          stdout: { text: "said [redacted:API_TOKEN]", cut: false },
          stderr: { text: "", cut: false },
        },
        recorded: [
          {
            kind: "command",
            detail: {
              step: "look.0",
              name: "evaluate",
              command: echoing,
              folder: "notes-in",
              end: exited,
              milliseconds: 0,
              inputHash: helloHash,
              stdoutHash: "",
              stderrHash: "",
            },
          },
        ],
      },
    ],
  },
};

type Asked = {
  readonly answer: Answer<Json>;
  readonly recorded: readonly Json[];
  readonly before: string;
  readonly after: string;
  readonly sent: number;
  readonly spent: Json;
};

async function treeOf(root: string, folder = root): Promise<readonly string[]> {
  const names = (await readdir(folder)).sort();
  const lines: string[] = [];
  for (const name of names) {
    const path = join(folder, name);
    const shown = path.slice(root.length);
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) {
      lines.push(`${shown} -> ${await readlink(path)}`);
    } else if (entry.isDirectory()) {
      lines.push(`${shown}/`, ...(await treeOf(root, path)));
    } else {
      lines.push(`${shown}: ${await readFile(path, "utf8")}`);
    }
  }
  return lines;
}

async function projectWithNotes(root: string): Promise<void> {
  await writeProjectFile(root, "notes-in/today.md", "today");
  await writeProjectFile(root, "notes-out/kept.txt", "kept");
  await writeProjectFile(root, "outside/secret.txt", "made-up outside text");
  await writeProjectFile(root, "scratch/old/a.txt", "old");
  await writeProjectFile(root, "components/modes/notes/migrations/0001-notes.sql", "create table notes (text text);\n");
  await symlink(join(root, "outside/secret.txt"), join(root, "notes-in/escape.txt"));
}

function shownJson(value: Json, root: string): Json {
  if (typeof value === "string") {
    return value.replaceAll(root, "<root>");
  }
  if (Array.isArray(value)) {
    return value.map((item: Json) => shownJson(item, root));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shownJson(item, root)]));
}

function shownAnswer(answer: Answer<Json>, root: string): Answer<Json> {
  if (answer.ok) {
    return answer;
  }
  const shown = (text: string): string => text.replaceAll(root, "<root>");
  if (answer.kind === "failed") {
    return { ...answer, message: shown(answer.message) };
  }
  return { ...answer, asked: shown(answer.asked), change: shown(answer.change), message: shown(answer.message) };
}

async function asked(asking: Asking): Promise<Asked> {
  let result: Asked | undefined;
  await withProject(async (root) => {
    await projectWithNotes(root);
    const events = recordingSink();
    const http = scriptedHttp(answeredRequest);
    const processes = recordingProcesses((request) =>
      exitedProcess(0, request.arguments[0] === "--version" ? "v1.0.0\n" : `said ${secretValue}`, ""),
    );
    const secrets = new SecretStore({
      environment: { AGENTBAY_SECRET_API_TOKEN: secretValue, AGENTBAY_SECRET_SECOND_TOKEN: secondSecretValue },
      processes: noProcesses,
      platform: "linux",
    });
    await secrets.lookUp("API_TOKEN");
    const grants = {
      throwawayPaths: [join(root, "scratch")],
      secrets: ["API_TOKEN", "SECOND_TOKEN"],
      hosts: ["api.example.com"],
      commands: [grantedCommand("version", "node --version"), grantedCommand("evaluate", "node -e")],
      ...asking.grants?.(root),
    };
    const broker = openStep({
      layout: projectLayout(root),
      permissions: permissionsIn(root, { effects: asking.effects, ...grants }),
      place,
      files: nodeFileSystem,
      throwawayFolders: nodeThrowawayFolders,
      inspector: nodeFileInspector,
      http,
      secrets,
      events,
      clock: fakeClock(new Date("2026-11-17T08:00:00Z")),
      childProcesses: nodeChildProcesses,
      processes,
      commandSearchPath: "/usr/bin:/bin",
      ...(asking.call === undefined ? {} : { call: asking.call }),
    });
    const before = (await treeOf(root)).join("\n");
    try {
      const answer = await asking.ask(broker);
      const recorded = events.events.map((event) => shownJson({ kind: event.kind, detail: event.detail }, root));
      const after = (await treeOf(root)).join("\n");
      const sent = http.requests.length + processes.requests.length;
      result = { answer: shownAnswer(answer, root), recorded, before, after, sent, spent: broker.spent() };
    } finally {
      broker.close();
    }
  });
  assert.ok(result !== undefined);
  return result;
}

async function assertRefusedAndNothingDone(name: string, refusing: Refusing): Promise<void> {
  const { answer, recorded, before, after, sent } = await asked(refusing);
  assert.ok(!answer.ok && answer.kind === "refused", `${name}: ${JSON.stringify(answer)}`);
  assert.equal(answer.change, refusing.change, name);
  const detail = { resource: answer.resource, step: "look.0", message: answer.message, ...refusing.detail };
  assert.deepEqual(recorded, [{ kind: "refused", detail }], name);
  assert.equal(after, before, `${name}: the project changed`);
  assert.equal(sent, 0, `${name}: a request was sent or a command was run`);
}

test("an operation without its needed effect is refused and does nothing", async () => {
  for (const [name, proof] of Object.entries(proofs)) {
    if (proof.withoutEffect === "needs no effect") {
      assert.ok(
        proof.allowed.every((allowed) => allowed.effects.length === 0),
        `${name} is allowed with no effects`,
      );
      continue;
    }
    for (const refusing of proof.withoutEffect) {
      await assertRefusedAndNothingDone(name, refusing);
    }
  }
});

async function assertFailedAndNothingDone(name: string, failing: Failing): Promise<void> {
  const { answer, recorded, before, after, sent } = await asked(failing);
  assert.deepEqual(answer, { ok: false, kind: "failed", message: failing.message }, name);
  assert.deepEqual(recorded, [], name);
  assert.equal(after, before, `${name}: the project changed`);
  assert.equal(sent, 0, `${name}: a request was sent or a command was run`);
}

test("an operation outside its grant is refused and does nothing", async () => {
  for (const [name, proof] of Object.entries(proofs)) {
    if ("refusedByTheCaller" in proof.outsideGrant) {
      for (const failing of proof.outsideGrant.refusedByTheCaller) {
        await assertFailedAndNothingDone(name, failing);
      }
      continue;
    }
    for (const refusing of proof.outsideGrant) {
      await assertRefusedAndNothingDone(name, refusing);
    }
  }
});

test("an allowed operation answers and is recorded where it was before the move", async () => {
  for (const [name, proof] of Object.entries(proofs)) {
    for (const allowed of proof.allowed) {
      const { answer, recorded, spent } = await asked(allowed);
      assert.deepEqual(answer, { ok: true, value: allowed.value }, name);
      assert.deepEqual(recorded, allowed.recorded, name);
      assert.deepEqual(spent, allowed.spent ?? nothingSpent, name);
    }
  }
});
