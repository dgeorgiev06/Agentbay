import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeProcesses, type FakeProcesses } from "../../../tests/fakes.ts";
import { adapter } from "../adapter.ts";
import type { ListOutcome } from "../adapter-types.ts";
import { guardEntry } from "../settings.ts";

import {
  allAgents,
  buildRequest,
  digestAgent,
  existingProject,
  kit,
  layout,
  memoryFiles,
  project,
  scanAgent,
  skillAgent,
  userClaude,
  userMcp,
  userSettings,
  type MemoryFiles,
} from "./build-fixture.ts";

const blockStart = "<!-- agentbay:start -->";

const blockEnd = "<!-- agentbay:end -->";

const shape = { mode: "x", skill: "y", tier: "fast", kernelTools: [], read: [], write: [], commands: [] } as const;

function lines(outcome: ListOutcome): readonly string[] {
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return outcome.value;
}

async function built(files: MemoryFiles, agents = allAgents): Promise<readonly string[]> {
  return lines(await adapter.build(buildRequest(files, agents)));
}

async function cleaned(files: MemoryFiles): Promise<readonly string[]> {
  return lines(await adapter.clean({ layout, files, removal: files.removal }));
}

function parsed(files: MemoryFiles, path: string): unknown {
  return JSON.parse(files.snapshot()[`${project}/${path}`] ?? "null");
}

const builtPaths = [
  ".agentbay/build.json",
  ".agentbay/steps.json",
  ".claude/agents/agentbay-forge-build.md",
  ".claude/agents/agentbay-mail-briefing-digest.md",
  ".claude/agents/agentbay-store-scan.md",
  ".claude/settings.json",
  ".mcp.json",
  "CLAUDE.md",
].map((path) => `${project}/${path}`);

test("the adapter is named claude-code", () => {
  assert.equal(adapter.name, "claude-code");
});

test("a build into an empty project writes every file and clean leaves the project empty again", async () => {
  const files = memoryFiles();
  const report = await built(files);
  assert.deepEqual(Object.keys(files.snapshot()), builtPaths);
  assert.ok(report.includes(".claude/agents/agentbay-store-scan.md: created"));
  assert.ok(report.includes(".claude/settings.json: merged"));
  assert.deepEqual(parsed(files, ".claude/settings.json"), { hooks: { PreToolUse: [guardEntry(layout)] } });
  assert.deepEqual(parsed(files, ".mcp.json"), {
    mcpServers: { agentbay: { command: "node", args: [`${kit}/bay/mcp.ts`, "--project", project] } },
  });
  const claude = files.snapshot()[`${project}/CLAUDE.md`] ?? "";
  assert.ok(claude.startsWith(`${blockStart}\n`) && claude.endsWith(`${blockEnd}\n`));
  assert.match(claude, /for any other, run `[^`]* runs <runId> --new-token --step <stepKey> --json`/);
  const cleanReport = await cleaned(files);
  assert.deepEqual(files.snapshot(), {});
  assert.ok(cleanReport.includes(".claude/settings.json: deleted; it held only what agentbay added"));
  assert.ok(cleanReport.includes(".agentbay/build.json: deleted"));
});

test("a build keeps the user's settings, servers and CLAUDE.md, and clean restores their exact bytes", async () => {
  const files = memoryFiles(existingProject);
  await built(files);
  const settings = parsed(files, ".claude/settings.json");
  assert.deepEqual(settings, {
    model: "opus",
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "mine" }] }, guardEntry(layout)],
      Stop: [],
    },
    permissions: { allow: ["Bash(ls:*)"], deny: ["Read(./secrets/**)"] },
  });
  assert.deepEqual(Object.keys(settings), ["model", "hooks", "permissions"]);
  assert.deepEqual(parsed(files, ".mcp.json"), {
    mcpServers: {
      mine: { command: "x", args: [] },
      agentbay: { command: "node", args: [`${kit}/bay/mcp.ts`, "--project", project] },
    },
    other: 1,
  });
  const claude = files.snapshot()[`${project}/CLAUDE.md`] ?? "";
  assert.ok(claude.startsWith(`${userClaude}\n\n${blockStart}\n`), claude);
  await cleaned(files);
  assert.deepEqual(files.snapshot(), existingProject);
});

const trustBlock = [
  "Trust in a mode is the owner's decision, never yours. When the check warns that a mode waits for trust,",
  "tell the owner, then run `/kit/bay.sh --project /proj approve --trust <mode> --json`. It changes nothing",
  "and exits 1; its output holds the card and the card's full hash. Show the owner every line of the card,",
  "unchanged and whole, then wait. Only after the owner answers in words that name the mode, run",
  '`/kit/bay.sh --project /proj approve --trust <mode> --hash <full hash> --via chat --quote "<the owner\'s exact words>" --json`.',
  "To withdraw trust when the owner asks for it, add `--reject` to both commands.",
].join("\n");

const neverWithTrust = [
  "- approve, give trust, run again, stop or raise a budget on your own, or quote words the owner did not write;",
  "- show a summary in place of a card, or suggest the owner skip reading it;",
  "- write the trust record `.agentbay/trust.json`, or edit a mode's list to match the list the owner trusted;",
].join("\n");

const neverBeforeTrust =
  "- approve, run again, stop or raise a budget on your own, or quote words the owner did not write;";

test("the built coordinator text tells the coordinator how the owner gives trust", async () => {
  const files = memoryFiles();
  await built(files);
  const claude = files.snapshot()[`${project}/CLAUDE.md`] ?? "";
  assert.ok(claude.includes(`\n\n${trustBlock}\n\nNever:\n${neverWithTrust}\n`), claude);
});

test("a build on a project built before the coordinator knew of trust rewrites its block", async () => {
  const files = memoryFiles({ [`${project}/CLAUDE.md`]: userClaude });
  await built(files);
  const claudePath = `${project}/CLAUDE.md`;
  const current = files.snapshot()[claudePath] ?? "";
  const before = current.replace(`${trustBlock}\n\n`, "").replace(neverWithTrust, neverBeforeTrust);
  assert.ok(!before.includes("trust"), before);
  await files.writeAtomic(claudePath, before);
  const report = await built(files);
  assert.equal(files.snapshot()[claudePath], current);
  assert.ok(report.includes("CLAUDE.md: updated"), report.join("\n"));
});

test("building twice changes nothing and clean still restores the starting bytes", async () => {
  for (const start of [{}, existingProject]) {
    const files = memoryFiles(start);
    await built(files);
    const first = files.snapshot();
    const report = await built(files);
    assert.deepEqual(files.snapshot(), first);
    assert.deepEqual(
      report.filter((line) => !line.endsWith(": unchanged")),
      [".agentbay/build.json: written"],
    );
    await cleaned(files);
    assert.deepEqual(files.snapshot(), start);
  }
});

test("a build after a hand edit of an agent file overwrites it and says so", async () => {
  const files = memoryFiles();
  await built(files);
  const path = `${project}/.claude/agents/agentbay-store-scan.md`;
  const generated = files.snapshot()[path];
  await files.writeAtomic(path, "---\nname: agentbay-store-scan\ntools: Bash, Agent\n---\n");
  const report = await built(files);
  assert.ok(
    report.includes(".claude/agents/agentbay-store-scan.md: overwritten; it was edited by hand since the last build"),
  );
  assert.equal(files.snapshot()[path], generated);
});

test("clean leaves a created file the user edited and reports it", async () => {
  const files = memoryFiles();
  await built(files);
  const path = `${project}/.claude/agents/agentbay-store-scan.md`;
  await files.writeAtomic(path, "mine now");
  const report = await cleaned(files);
  assert.ok(report.includes(".claude/agents/agentbay-store-scan.md: changed since the build, left in place"));
  assert.deepEqual(files.snapshot(), { [path]: "mine now" });
});

test("clean keeps edits the user made to a merged file after the build", async () => {
  const files = memoryFiles(existingProject);
  await built(files);
  const settingsPath = `${project}/.claude/settings.json`;
  const settings: unknown = JSON.parse(files.snapshot()[settingsPath] ?? "{}");
  assert.ok(typeof settings === "object" && settings !== null);
  await files.writeAtomic(settingsPath, JSON.stringify({ ...settings, theme: "dark" }));
  await files.writeAtomic(`${project}/CLAUDE.md`, `${files.snapshot()[`${project}/CLAUDE.md`] ?? ""}\nAdded later.\n`);
  const report = await cleaned(files);
  assert.ok(report.includes(".claude/settings.json: agentbay's part removed, later edits kept"));
  assert.deepEqual(parsed(files, ".claude/settings.json"), { ...JSON.parse(userSettings), theme: "dark" });
  assert.equal(files.snapshot()[`${project}/CLAUDE.md`], `${userClaude}\nAdded later.\n`);
  assert.equal(files.snapshot()[`${project}/.mcp.json`], userMcp);
});

test("settings that the build created and the user extended keep only the user's part", async () => {
  const files = memoryFiles();
  await built(files);
  const settingsPath = `${project}/.claude/settings.json`;
  await files.writeAtomic(
    settingsPath,
    JSON.stringify({ hooks: { PreToolUse: [guardEntry(layout)] }, model: "haiku" }),
  );
  await cleaned(files);
  assert.deepEqual(files.snapshot(), { [settingsPath]: '{\n  "model": "haiku"\n}\n' });
});

test("a hand-changed agentbay hook entry is left in place by clean and refused by build", async () => {
  const files = memoryFiles();
  await built(files);
  const settingsPath = `${project}/.claude/settings.json`;
  const loosened = { hooks: { PreToolUse: [{ ...guardEntry(layout), matcher: "Write" }] } };
  await files.writeAtomic(settingsPath, JSON.stringify(loosened));
  const outcome = await adapter.build(buildRequest(files));
  assert.ok(!outcome.ok);
  const settingsProblem = outcome.problems.find((problem) => problem.file === ".claude/settings.json");
  assert.match(settingsProblem?.message ?? "", /changed by hand/);
  const report = await cleaned(files);
  assert.ok(
    report.includes(".claude/settings.json: the part agentbay added was changed since the build, left in place"),
  );
  assert.deepEqual(files.snapshot(), { [settingsPath]: JSON.stringify(loosened) });
});

test("a block the user moved stays in place when the build replaces it, and clean removes it", async () => {
  const files = memoryFiles({ [`${project}/CLAUDE.md`]: userClaude });
  await built(files);
  const claudePath = `${project}/CLAUDE.md`;
  const current = files.snapshot()[claudePath] ?? "";
  const block = current.slice(current.indexOf(blockStart));
  const moved = `${block.replace("You are the owner's coordinator.", "Edited.")}\n# mine\n\nKeep this.`;
  await files.writeAtomic(claudePath, moved);
  await built(files);
  const rebuilt = files.snapshot()[claudePath] ?? "";
  assert.ok(rebuilt.startsWith(blockStart) && rebuilt.endsWith("\n# mine\n\nKeep this."), rebuilt);
  assert.ok(rebuilt.includes("You are the owner's coordinator."));
  await cleaned(files);
  assert.equal(files.snapshot()[claudePath], "\n# mine\n\nKeep this.");
});

test("a server the user had under the name agentbay comes back after clean", async () => {
  const own = '{"mcpServers": {"agentbay": {"command": "my-own"}}}';
  const files = memoryFiles({ [`${project}/.mcp.json`]: own });
  await built(files);
  await files.writeAtomic(`${project}/.mcp.json`, `${files.snapshot()[`${project}/.mcp.json`] ?? ""}\n`);
  await cleaned(files);
  assert.deepEqual(parsed(files, ".mcp.json"), JSON.parse(own));
});

test("a step that is no longer built has its agent file deleted, unless the user edited it", async () => {
  const files = memoryFiles();
  await built(files);
  const scanPath = `${project}/.claude/agents/agentbay-store-scan.md`;
  const report = await built(files, [digestAgent]);
  assert.ok(report.includes(".claude/agents/agentbay-store-scan.md: deleted; no step needs it now"));
  assert.equal(files.snapshot()[scanPath], undefined);
  await built(files, [digestAgent, scanAgent]);
  await files.writeAtomic(scanPath, "edited");
  const second = await built(files, [digestAgent]);
  assert.ok(second.some((line) => line.startsWith(".claude/agents/agentbay-store-scan.md: no longer built")));
  assert.equal(files.snapshot()[scanPath], "edited");
});

test("a build refuses to overwrite a file agentbay did not write, and writes nothing", async () => {
  const start = { [`${project}/.claude/agents/agentbay-store-scan.md`]: "the user's own agent" };
  const files = memoryFiles(start);
  const outcome = await adapter.build(buildRequest(files));
  assert.ok(!outcome.ok);
  assert.equal(outcome.problems[0]?.file, ".claude/agents/agentbay-store-scan.md");
  assert.deepEqual(files.snapshot(), start);
});

test("a malformed settings file, server file or record is reported and nothing is written", async () => {
  const cases = [
    { [`${project}/.claude/settings.json`]: "{ not json" },
    { [`${project}/.claude/settings.json`]: '{"hooks": []}' },
    { [`${project}/.claude/settings.json`]: '{"hooks": {"PreToolUse": {}}}' },
    { [`${project}/.mcp.json`]: "[]" },
    { [`${project}/.mcp.json`]: '{"mcpServers": 3}' },
    { [`${project}/.agentbay/build.json`]: '{"version": 1, "adapter": "claude-code", "created": [{}], "merged": []}' },
  ];
  for (const start of cases) {
    const files = memoryFiles(start);
    const outcome = await adapter.build(buildRequest(files));
    assert.ok(!outcome.ok, JSON.stringify(start));
    assert.deepEqual(files.snapshot(), start);
  }
  const broken = memoryFiles({ [`${project}/.agentbay/build.json`]: "nope" });
  const outcome = await adapter.clean({ layout, files: broken, removal: broken.removal });
  assert.ok(!outcome.ok);
  assert.equal(outcome.problems[0]?.file, ".agentbay/build.json");
});

test("a build reports every problem with the request at once", async () => {
  const renamed = { ...digestAgent, agent: "digest" };
  const oddTool = { ...scanAgent, kernelTools: ["files_read", "mcp__x__*"] };
  const layout = { project: "proj", kit: "/k'it", configFile: "proj/agentbay.config.yaml" };
  const request = { ...buildRequest(memoryFiles(), [renamed, oddTool, oddTool]), layout };
  const outcome = await adapter.build(request);
  assert.ok(!outcome.ok);
  const messages = outcome.problems.map((problem) => problem.message);
  assert.equal(messages.length, 6, messages.join("\n"));
  assert.ok(messages.some((message) => message.includes("absolute")));
  assert.ok(messages.some((message) => message.includes("cannot be quoted")));
  assert.ok(messages.some((message) => message.includes("agent name digest")));
  assert.ok(messages.some((message) => message.includes("share the agent name")));
  assert.ok(messages.some((message) => message.includes('"mcp__x__*"')));
});

test("clean with no build record is a no-op that says so", async () => {
  const files = memoryFiles(existingProject);
  assert.deepEqual(await cleaned(files), [".agentbay/build.json: no build record, so there is nothing to clean"]);
  assert.deepEqual(files.snapshot(), existingProject);
});

test("the record lists the folders the build created, deepest first, and clean reports them", async () => {
  const empty = memoryFiles();
  await built(empty);
  const record: unknown = JSON.parse(empty.snapshot()[`${project}/.agentbay/build.json`] ?? "{}");
  assert.ok(typeof record === "object" && record !== null && "createdFolders" in record);
  assert.deepEqual(record.createdFolders, [".claude/agents", ".agentbay", ".claude"]);
  const report = await cleaned(empty);
  assert.ok(report.includes(".claude/agents/: deleted; the build had created it"));
  const existing = memoryFiles({ ...existingProject, [`${project}/.agentbay/kernel.db`]: "data" });
  await built(existing);
  const kept: unknown = JSON.parse(existing.snapshot()[`${project}/.agentbay/build.json`] ?? "{}");
  assert.ok(typeof kept === "object" && kept !== null && "createdFolders" in kept);
  assert.deepEqual(kept.createdFolders, [".claude/agents"]);
  await cleaned(existing);
  assert.deepEqual(existing.snapshot(), { ...existingProject, [`${project}/.agentbay/kernel.db`]: "data" });
});

test("a build refuses a step granted a folder that holds a closed name, and writes nothing", async () => {
  for (const secret of ["notes/.env", "notes/deep/.env.local", "notes/.git/config", "notes/sub/.Agentbay/x"]) {
    const start = { [`${project}/${secret}`]: "secret", [`${project}/notes/a.md`]: "a" };
    const files = memoryFiles(start);
    const outcome = await adapter.build(buildRequest(files));
    assert.ok(!outcome.ok, secret);
    assert.match(outcome.problems[0]?.message ?? "", /is granted \/proj\/notes, which holds \/proj\/notes\//);
    assert.equal(outcome.problems[0]?.file, digestAgent.skillFile);
    assert.deepEqual(files.snapshot(), start);
  }
  const closedRoot = skillAgent({ ...shape, write: [`${project}/.agentbay/out`] });
  const outcome = await adapter.build(buildRequest(memoryFiles(), [closedRoot]));
  assert.ok(!outcome.ok);
  assert.match(outcome.problems[0]?.message ?? "", /names a closed location/);
});

const pointer = `${project}/notes/wt/.git`;

function withPointer(text: string): MemoryFiles {
  return memoryFiles({ [pointer]: text, [`${project}/notes/wt/a.ts`]: "a" });
}

test("a build passes a granted folder that holds a git worktree's pointer into the project's own worktrees", async () => {
  for (const text of [`gitdir: ${project}/.git/worktrees/wt\n`, `gitdir: ${project}/.git/worktrees/other-name`]) {
    const outcome = await adapter.build(buildRequest(withPointer(text)));
    assert.ok(outcome.ok, `${text}: ${JSON.stringify(outcome)}`);
  }
});

test("a pointer names the project's worktrees by its real path, as git writes it when the project is reached by a link", async () => {
  const files = withPointer("gitdir: /real/proj/.git/worktrees/wt\n");
  const realPath = (path: string) => Promise.resolve(path === project ? "/real/proj" : path);
  const linked = { ...files, inspector: { ...files.inspector, realPath } };
  const outcome = await adapter.build(buildRequest(linked));
  assert.ok(outcome.ok, JSON.stringify(outcome));
  assert.ok(!(await adapter.build(buildRequest(files))).ok);
  const written = withPointer(`gitdir: ${project}/.git/worktrees/wt\n`);
  assert.ok(!(await adapter.build(buildRequest({ ...written, inspector: { ...written.inspector, realPath } }))).ok);
});

test("a build refuses a .git entry that is not exactly a pointer into the project's own worktrees", async () => {
  const refused = [
    `gitdir: ${project}/.git/worktrees/wt\nextra\n`,
    `gitdir: ${project}/.git/worktrees/wt\n\n`,
    `gitdir: ${project}/.git/worktrees/wt\r\n`,
    ` gitdir: ${project}/.git/worktrees/wt\n`,
    `gitdir:${project}/.git/worktrees/wt\n`,
    `GITDIR: ${project}/.git/worktrees/wt\n`,
    `x gitdir: ${project}/.git/worktrees/wt\n`,
    "gitdir: /elsewhere/.git/worktrees/wt\n",
    `gitdir: ${project}/.git\n`,
    `gitdir: ${project}/.git/modules/wt\n`,
    `gitdir: ${project}/.git/worktrees/\n`,
    `gitdir: ${project}/.git/worktrees/wt/deeper\n`,
    `gitdir: ${project}/.git/worktrees/../wt\n`,
    `gitdir: ${project}/.git/worktrees//wt\n`,
    `gitdir: ${project}/.git/worktrees/./wt\n`,
    `gitdir: ${project}/.git/worktrees/..\n`,
    `gitdir: ${project}/.git/worktrees/.\n`,
    "gitdir: proj/.git/worktrees/wt\n",
    "gitdir: \n",
    "ref: refs/heads/main\n",
    "",
  ];
  for (const text of refused) {
    const files = withPointer(text);
    const outcome = await adapter.build(buildRequest(files));
    assert.ok(!outcome.ok, JSON.stringify(text));
    assert.deepEqual(
      outcome.problems.map(({ file, message }) => ({ file, message })),
      [
        {
          file: digestAgent.skillFile,
          message: `the step ${digestAgent.agent} is granted /proj/notes, which holds ${pointer}`,
        },
      ],
    );
    assert.equal(files.snapshot()[`${project}/.agentbay/build.json`], undefined);
  }
});

test("a worktree's pointer lets nothing else through when git cannot say what the worktree tracks", async () => {
  const valid = `gitdir: ${project}/.git/worktrees/wt\n`;
  const cases: readonly (readonly [Readonly<Record<string, string>>, string])[] = [
    [{ [`${pointer}/HEAD`]: valid }, pointer],
    [{ [`${project}/notes/wt/.GIT`]: valid }, `${project}/notes/wt/.GIT`],
    [{ [pointer]: valid, [`${project}/notes/wt/.env`]: "" }, `${project}/notes/wt/.env`],
    [
      { [pointer]: valid, [`${project}/notes/wt/agentbay.config.yaml`]: "" },
      `${project}/notes/wt/agentbay.config.yaml`,
    ],
    [{ [pointer]: valid, [`${project}/notes/wt/sub/CLAUDE.md`]: "" }, `${project}/notes/wt/sub/CLAUDE.md`],
  ];
  for (const [start, holds] of cases) {
    const outcome = await adapter.build(buildRequest(memoryFiles(start)));
    assert.ok(!outcome.ok, holds);
    assert.equal(
      outcome.problems[0]?.message,
      `the step ${digestAgent.agent} is granted /proj/notes, which holds ${holds}`,
    );
  }
});

const worktree = `${project}/notes/wt`;

const blob = "0123456789abcdef0123456789abcdef01234567";

function indexOf(records: readonly (readonly [string, string, string])[]): string {
  return records.map(([mode, stage, path]) => `${mode} ${blob} ${stage}\t${path}\0`).join("");
}

const index = indexOf([
  ["100644", "0", "agentbay.config.yaml"],
  ["100644", "0", "CLAUDE.md"],
  ["100755", "0", ".claude/settings.json"],
  ["100644", "0", ".mcp.json"],
  ["100644", "0", ".env.example"],
  ["100644", "0", "deep/.ENV.Sample"],
  ["100644", "0", "config/.env.template"],
  ["100644", "0", ".agentbay/notes.md"],
  ["100644", "0", ".env"],
  ["100644", "0", "app/.env.local"],
  ["100644", "0", ".env.example.local"],
  ["120000", "0", "docs/CLAUDE.md"],
  ["100644", "1", "conflict/CLAUDE.md"],
  ["100644", "0", "sub/.git/HEAD"],
  ["100644", "0", ".GIT"],
  ["100644", "0", "src/app.ts"],
]);

type Contents = readonly (readonly [string, string])[];

function emptyFiles(folder: string, names: readonly string[]): Contents {
  return names.map((name) => [`${folder}/${name}`, ""]);
}

function numbered(prefix: string, count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index)}`);
}

async function builtWithIndex(paths: readonly string[], git: FakeProcesses): Promise<ListOutcome> {
  const start = Object.fromEntries([
    [pointer, `gitdir: ${project}/.git/worktrees/wt\n`],
    ...emptyFiles(worktree, paths),
  ]);
  return adapter.build(buildRequest(memoryFiles(start), allAgents, git));
}

test("inside a worktree of the project, a closed name git tracks as a regular file is a copy and passes", async () => {
  const copies = [
    "agentbay.config.yaml",
    "CLAUDE.md",
    ".claude/settings.json",
    ".mcp.json",
    ".env.example",
    "deep/.ENV.Sample",
    "config/.env.template",
    ".agentbay/notes.md",
  ];
  for (const copy of copies) {
    const outcome = await builtWithIndex([copy, "src/app.ts"], fakeProcesses(index));
    assert.ok(outcome.ok, `${copy}: ${JSON.stringify(outcome)}`);
  }
  const git = fakeProcesses(index);
  assert.ok((await builtWithIndex(copies, git)).ok);
  assert.deepEqual(git.asked, [
    {
      command: "git",
      arguments: [
        `--git-dir=${project}/.git/worktrees/wt`,
        `--work-tree=${worktree}`,
        "-c",
        "core.fsmonitor=false",
        "--no-optional-locks",
        "ls-files",
        "--stage",
        "-z",
      ],
      directory: worktree,
      environment: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      timeoutMilliseconds: 30_000,
    },
  ]);
});

test("a worktree with no closed name but its pointer passes without asking git", async () => {
  const git = fakeProcesses("", { how: "exited", exitCode: 128 });
  assert.ok((await builtWithIndex(["src/app.ts", "README.md"], git)).ok);
  assert.deepEqual(git.asked, []);
});

test("inside a worktree, an untracked, secret, linked, conflicted or git-named closed entry refuses in the same sentence", async () => {
  const refused: readonly (readonly [string, string])[] = [
    ["other/CLAUDE.md", "other/CLAUDE.md"],
    [".claude/extra.json", ".claude/extra.json"],
    [".mcp.json/x", ".mcp.json"],
    [".env", ".env"],
    ["app/.env.local", "app/.env.local"],
    [".env.example.local", ".env.example.local"],
    ["docs/CLAUDE.md", "docs/CLAUDE.md"],
    ["conflict/CLAUDE.md", "conflict/CLAUDE.md"],
    ["sub/.git/HEAD", "sub/.git"],
    [".GIT", ".GIT"],
    ["src/app.ts/CLAUDE.md", "src/app.ts/CLAUDE.md"],
  ];
  for (const [path, holds] of refused) {
    const outcome = await builtWithIndex([path], fakeProcesses(index));
    assert.ok(!outcome.ok, path);
    assert.equal(
      outcome.problems[0]?.message,
      `the step ${digestAgent.agent} is granted /proj/notes, which holds ${worktree}/${holds}`,
    );
  }
});

test("inside a worktree, a closed copy refuses whenever git does not answer whole and plainly", async () => {
  const cut: FakeProcesses = {
    asked: [],
    run: () =>
      Promise.resolve({
        end: { how: "exited", exitCode: 0 },
        stdout: { text: index, characters: index.length + 1, hash: "" },
        stderr: { text: "", characters: 0, hash: "" },
      }),
  };
  const answers: readonly FakeProcesses[] = [
    fakeProcesses(index, { how: "exited", exitCode: 1 }),
    fakeProcesses(index, { how: "timed-out" }),
    fakeProcesses(index, { how: "signalled", signal: "SIGKILL" }),
    fakeProcesses("", { how: "not-started", reason: "no git" }),
    fakeProcesses(index.slice(0, -1)),
    fakeProcesses(`${index}garbage\0`),
    fakeProcesses(index.replace("100644 ", "10064 ")),
    fakeProcesses(index.replace(blob, blob.slice(1))),
    cut,
  ];
  for (const git of answers) {
    const outcome = await builtWithIndex(["CLAUDE.md"], git);
    assert.ok(!outcome.ok);
    assert.equal(
      outcome.problems[0]?.message,
      `the step ${digestAgent.agent} is granted /proj/notes, which holds ${worktree}/CLAUDE.md`,
    );
  }
});

test("a folder whose pointer leads elsewhere is no worktree of the project: its tracked-looking copies refuse", async () => {
  const start = { [pointer]: "gitdir: /other/.git/worktrees/wt\n", [`${worktree}/CLAUDE.md`]: "" };
  const git = fakeProcesses(index);
  const outcome = await adapter.build(buildRequest(memoryFiles(start), allAgents, git));
  assert.ok(!outcome.ok);
  assert.deepEqual(git.asked, []);
});

test("a worktree inside a worktree is no copy: its pointer refuses", async () => {
  const inner = `${worktree}/inner/.git`;
  const start = {
    [pointer]: `gitdir: ${project}/.git/worktrees/wt\n`,
    [inner]: `gitdir: ${project}/.git/worktrees/inner\n`,
  };
  const outcome = await adapter.build(buildRequest(memoryFiles(start), allAgents, fakeProcesses(index)));
  assert.ok(!outcome.ok);
  assert.equal(
    outcome.problems[0]?.message,
    `the step ${digestAgent.agent} is granted /proj/notes, which holds ${inner}`,
  );
});

test("each worktree of the project has its own scan bound, and an ordinary folder keeps the bound", async () => {
  const deep = `${project}/notes/${numbered("d", 10).join("/")}`;
  const spread = Object.fromEntries([
    ...emptyFiles(`${project}/notes`, numbered("f", 3000)),
    ...["a", "b"].flatMap((name): Contents => [
      [`${deep}/${name}/.git`, `gitdir: ${project}/.git/worktrees/${name}\n`],
      ...emptyFiles(`${deep}/${name}/${numbered("d", 5).join("/")}`, numbered("f", 3000)),
    ]),
  ]);
  assert.ok((await adapter.build(buildRequest(memoryFiles(spread)))).ok);
  const oneTooMany = Object.fromEntries([
    [pointer, `gitdir: ${project}/.git/worktrees/wt\n`],
    ...emptyFiles(worktree, numbered("f", 5001)),
  ]);
  const wide = await adapter.build(buildRequest(memoryFiles(oneTooMany)));
  assert.ok(!wide.ok);
  assert.match(wide.problems[0]?.message ?? "", /more than 5000 entries/);
});

test("a build refuses a granted folder larger than the bound it checks", async () => {
  const many = Object.fromEntries(
    Array.from({ length: 5001 }, (_, index) => [`${project}/notes/f${String(index)}`, ""]),
  );
  const wide = await adapter.build(buildRequest(memoryFiles(many)));
  assert.ok(!wide.ok);
  assert.match(wide.problems[0]?.message ?? "", /more than 5000 entries/);
  const levels = Array.from({ length: 13 }, (_, level) => `d${String(level)}`);
  const deep = await adapter.build(buildRequest(memoryFiles({ [`${project}/notes/${levels.join("/")}/x`]: "" })));
  assert.ok(!deep.ok);
  assert.match(deep.problems[0]?.message ?? "", /deeper than 12 levels/);
  const allowed = memoryFiles({ [`${project}/notes/${levels.slice(0, 11).join("/")}/x`]: "" });
  assert.ok((await adapter.build(buildRequest(allowed))).ok);
});
