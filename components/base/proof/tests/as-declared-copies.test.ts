import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fieldsOf, type CommandRan, type CommandRequest, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { asDeclaredEvidence } from "../scripts/kinds/as-declared.ts";
import type { Request } from "../scripts/lib/request.ts";
import { ProofStep } from "../scripts/lib/step.ts";

type Files = Readonly<Record<string, string>>;

type Asked = { readonly calls: string[]; readonly reads: CommandRequest[] };

type Read = { readonly ran: CommandRan } | { readonly failed: string };

const manifest = "fixtures/notes/mode.yaml";

const notesBefore = "name: notes\nactions:\n  write:\n    effects: [write]\n";

const notesAfter = "name: notes\nactions:\n  write:\n    effects: [write, delete]\n";

const notHere = { ok: false, kind: "failed", message: "This test does not answer it." } as const;

const request: Request = {
  base: "base",
  head: "head",
  scope: ["**"],
  proven: [],
  judgement: [],
  declared: { files: [manifest], names: { gained: [], lost: [], changed: ["notes.write"] } },
  bugs: [],
  sameOutput: [],
  noRise: [],
};

function printed(text: string, milliseconds: number): Read {
  const output = { text: "", cut: false };
  return { ran: { end: { how: "exited", exitCode: 0 }, milliseconds, stdout: { text, cut: false }, stderr: output } };
}

function copyNameOf(input: Json): string {
  const name = fieldsOf(input).name;
  return typeof name === "string" ? name : "";
}

function callAnswer(reference: string, input: Json, changed: readonly string[]): Json {
  switch (reference) {
    case "worktrees.changed":
      return { paths: changed.map((path) => ({ path, how: "modified" })) };
    case "worktrees.copy":
      return { folder: `.forge/copies/${copyNameOf(input)}` };
    default:
      return null;
  }
}

function contextOf(asked: Asked, reads: readonly Read[], changed: readonly string[]): ScriptContext {
  const unanswered = (): Promise<typeof notHere> => Promise.resolve(notHere);
  const statements = { execute: unanswered, query: unanswered };
  let readsMade = 0;
  return {
    db: { ...statements, partition: () => ({ ...statements, migrate: unanswered, agentQuery: unanswered }) },
    files: {
      read: unanswered,
      write: unanswered,
      list: unanswered,
      makeFolder: unanswered,
      link: unanswered,
      remove: unanswered,
    },
    secrets: { get: unanswered },
    http: { request: unanswered },
    events: { emit: unanswered },
    commands: {
      run: (command) => {
        asked.reads.push(command);
        const read = reads[readsMade] ?? { failed: "No read was planned." };
        readsMade += 1;
        return Promise.resolve(
          "ran" in read ? { ok: true, value: read.ran } : { ok: false, kind: "failed", message: read.failed },
        );
      },
    },
    call: (reference, input) => {
      asked.calls.push(reference);
      return Promise.resolve({ ok: true, value: callAnswer(reference, input, changed) });
    },
    schemas: { check: unanswered },
    settings: {},
    now: () => new Date("2026-11-18T10:00:00Z"),
    spend: unanswered,
    caller: undefined,
    skillInput: undefined,
  };
}

async function gathered(
  spentBefore: number,
  reads: readonly Read[],
  changed: readonly string[] = [manifest],
): Promise<{ readonly asked: Asked; readonly found: unknown }> {
  const asked: Asked = { calls: [], reads: [] };
  const step = new ProofStep(contextOf(asked, reads, changed));
  step.spend(spentBefore);
  return { asked, found: await asDeclaredEvidence(step, request) };
}

test("as-declared: an action changed in the kit's interface file and in a project's interface file is seen, and other yaml is not read", async () => {
  const kitInterface = "components/base/interfaces/worktrees.yaml";
  const projectInterface = "components/interfaces/notes.yaml";
  const notInterfaces = ["components/base/interfaces/worktrees/changed.yaml", "fixtures/notes.yaml"];
  const worktreesBefore = "name: worktrees\nversion: 1\nactions:\n  changed:\n    effects: [read]\n";
  const worktreesAfter = "name: worktrees\nversion: 1\nactions:\n  changed:\n    effects: [read, write]\n";
  const reads = [worktreesBefore, notesBefore, worktreesAfter, notesAfter].map((text) => printed(text, 0));
  const changed = [kitInterface, projectInterface, ...notInterfaces];
  const { asked, found } = await gathered(0, reads, changed);
  assert.deepEqual(found, {
    found: "changed",
    paths: [kitInterface, projectInterface, ...notInterfaces],
    names: { gained: [], lost: [], changed: ["worktrees.changed", "notes.write"] },
  });
  assert.deepEqual(
    asked.reads.map((read) => read.arguments),
    [[kitInterface], [projectInterface], [kitInterface], [projectInterface]],
  );
});

const copiedTwice = ["worktrees.changed", "worktrees.copy", "worktrees.remove", "worktrees.copy", "worktrees.remove"];

test("as-declared: each read asks for what is left of the step by the library's clock, and each copy is removed", async () => {
  const { asked, found } = await gathered(1000, [printed(notesBefore, 30_000), printed(notesAfter, 1_000)]);
  assert.deepEqual(found, {
    found: "changed",
    paths: [manifest],
    names: { gained: [], lost: [], changed: ["notes.write"] },
  });
  assert.deepEqual(
    asked.reads.map((read) => [read.name, read.arguments, read.folder, read.timeLimitSeconds]),
    [
      ["read-file", [manifest], ".forge/copies/proof-1794996000000-1", 730],
      ["read-file", [manifest], ".forge/copies/proof-1794996000000-2", 690],
    ],
  );
  assert.deepEqual(asked.calls, copiedTwice);
});

test("as-declared: a read with no time left is not made, its part is inconclusive, and the copy is removed", async () => {
  const { asked, found } = await gathered(1735, []);
  assert.deepEqual(found, {
    found: "names not known",
    reason: "fixtures/notes/mode.yaml at the base was not read: proof's own step had no time left for it.",
  });
  assert.deepEqual(asked.reads, []);
  assert.deepEqual(asked.calls, ["worktrees.changed", "worktrees.copy", "worktrees.remove"]);
});

test("as-declared: a read that failed, was stopped at its limit or printed too much is inconclusive, and the copy is removed", async () => {
  const stopped: Read = {
    ran: {
      end: { how: "timed-out" },
      milliseconds: 730_000,
      stdout: { text: "", cut: false },
      stderr: { text: "", cut: false },
    },
  };
  const cut: Read = {
    ran: {
      end: { how: "exited", exitCode: 0 },
      milliseconds: 5,
      stdout: { text: "name: n", cut: true },
      stderr: { text: "", cut: false },
    },
  };
  const reasons = [
    [
      { failed: "The command could not start." },
      "fixtures/notes/mode.yaml at the base could not be read: The command could not start.",
    ],
    [stopped, "Reading fixtures/notes/mode.yaml at the base did not finish within 730 seconds."],
    [cut, "fixtures/notes/mode.yaml at the base is longer than proof reads, so its action names are not known."],
  ] as const;
  for (const [read, reason] of reasons) {
    const { asked, found } = await gathered(1000, [read]);
    assert.deepEqual(found, { found: "names not known", reason });
    assert.deepEqual(asked.calls, ["worktrees.changed", "worktrees.copy", "worktrees.remove"]);
  }
});

let project: ModeProject;

function git(...parameters: readonly string[]): string {
  const identity = ["-c", "user.name=Proof Test", "-c", "user.email=proof-test@agentbay.invalid"];
  return execFileSync("git", [...identity, ...parameters], { cwd: project.root, encoding: "utf8" });
}

async function committed(files: Files, links: Files = {}): Promise<string> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(project.root, path)), { recursive: true });
    await writeFile(join(project.root, path), text, "utf8");
  }
  for (const [path, target] of Object.entries(links)) {
    await mkdir(dirname(join(project.root, path)), { recursive: true });
    await symlink(target, join(project.root, path));
  }
  git("add", "--all");
  git("commit", "--quiet", "--message", "A commit for proof's own test");
  return git("rev-parse", "HEAD").trim();
}

before(async () => {
  const given = await realpath(await mkdtemp(join(tmpdir(), "agentbay-proof-declared-")));
  try {
    await mkdir(join(given, "components"), { recursive: true });
    await writeFile(join(given, "agentbay.config.yaml"), "adapter: claude-code\nbindings: {}\n", "utf8");
    project = await openModeProject(
      {
        adapter: "claude-code",
        modes: ["proof", "git-worktrees", "typescript"],
        bindings: { toolchain: "typescript", worktrees: "git-worktrees" },
      },
      { project: given },
    );
  } finally {
    await rm(given, { recursive: true, force: true });
  }
  await mkdir(join(project.root, "node_modules"), { recursive: true });
});

after(async () => {
  await project.close();
});

function sliceOnly(base: string, head: string): Json {
  return {
    slice: {
      name: "DECLARED",
      kind: "mode",
      scope: ["fixtures/**"],
      after: [],
      done: [{ id: "words", says: "The words tell the owner what to do.", level: "should" }],
    },
    base,
    head,
    declared: { files: [manifest], names: { gained: [], lost: [], changed: ["notes.write"] } },
    bugs: [],
  };
}

function verdictsOf(output: Json): Json {
  return fieldsOf(output).verdicts ?? null;
}

test("as-declared with the real git-worktrees mode: action names read in two copies, and every copy removed, also when a read fails", async () => {
  const ignored = [".agentbay/", ".forge/", "node_modules", "components/", "agentbay.config.yaml"];
  const base = await committed({ ".gitignore": `${ignored.join("\n")}\n`, [manifest]: notesBefore });
  const head = await committed({ [manifest]: notesAfter });
  assert.deepEqual(verdictsOf(await project.output("proof.prove", sliceOnly(base, head))), [
    { item: "scope", kind: "in-scope", verdict: "passed", detail: "Every changed path is in the scope: 1 of 1." },
    {
      item: "declared",
      kind: "as-declared",
      verdict: "passed",
      detail: "What changed is as declared: 1 file and 1 action name.",
    },
  ]);
  assert.deepEqual(await readdir(join(project.root, ".forge", "copies")), []);
  const dangling = await committed({}, { "fixtures/lost/mode.yaml": "nowhere.yaml" });
  assert.deepEqual(verdictsOf(await project.output("proof.prove", sliceOnly(head, dangling))), [
    { item: "scope", kind: "in-scope", verdict: "passed", detail: "Every changed path is in the scope: 1 of 1." },
    {
      item: "declared",
      kind: "as-declared",
      verdict: "inconclusive",
      reason: "Reading fixtures/lost/mode.yaml at the head ended with the exit code 1.",
    },
  ]);
  assert.deepEqual(await readdir(join(project.root, ".forge", "copies")), []);
});

test("in-scope: the request's schema refuses a scope entry that is not a pattern before proof runs", async () => {
  const input = fieldsOf(sliceOnly("base", "head"));
  const slice = { ...fieldsOf(input.slice ?? null), scope: ["../up/**"] };
  assert.equal(
    await project.refusal("proof.prove", { ...input, slice }),
    "input.slice.scope.0 is not in the expected form. Expected: A path relative to the repository's root, or a pattern " +
      "of paths. A * stands for any characters inside one folder or file name; a ** that is a whole part stands for " +
      "any number of folders. bay/broker/** holds every file under bay/broker/, and not bay/brokers.ts.",
  );
});
