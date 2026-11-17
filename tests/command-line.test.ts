import assert from "node:assert/strict";
import { test } from "node:test";
import { runCommandLine, type Command } from "../bay/command-line.ts";
import { commands } from "../bay/commands.ts";
import { bay, contextFor } from "./cli-fixture.ts";

const thirteen = [
  "check",
  "new",
  "actions",
  "call",
  "submit",
  "runs",
  "approve",
  "resume",
  "build",
  "secret",
  "auth",
  "config",
  "import-v4",
];

const dropped = ["describe", "catalog", "note", "plan", "show", "status", "clean", "validate", "lint", "tool", "help"];

test("the command table holds the thirteen commands, and --help lists exactly them", async () => {
  assert.deepEqual(
    commands.map((command) => command.name),
    thirteen,
  );
  const help = await bay(["--help"]);
  assert.equal(help.exitCode, 0);
  const listed = help.output
    .split("\n")
    .filter((line) => /^ {2}\S/.test(line))
    .map((line) => line.trim().split(/\s+/)[0]);
  assert.deepEqual(listed, thirteen);
});

test("an old or unknown command name is a wrong command line, exit 2", async () => {
  for (const name of dropped) {
    const ran = await bay([name]);
    assert.equal(ran.exitCode, 2, name);
    assert.match(ran.output, new RegExp(`There is no command ${name}\\.`));
  }
  const nothing = await bay([]);
  assert.equal(nothing.exitCode, 2);
  assert.match(nothing.output, /No command was given/);
});

test("with --json a wrong command line prints exactly one JSON object", async () => {
  const ran = await bay(["approve", "run-1", "keep", "--json"]);
  assert.equal(ran.exitCode, 2);
  assert.deepEqual(ran.json, { ok: false, usage: "approve needs --hash <the hash of what the approval shows>." });
  assert.equal(ran.output.split("\n").length, 1);
});

const echo: Command = {
  name: "echo",
  summary: "Prints what it was given.",
  usage: "echo <word> [--loud] [--times <n>]",
  options: [
    { name: "loud", takesValue: false },
    { name: "times", takesValue: true },
  ],
  positionals: { least: 1, most: 2 },
  handler: (invocation) =>
    Promise.resolve({
      exitCode: 0,
      json: {
        project: invocation.layout.project,
        positionals: [...invocation.positionals],
        values: Object.fromEntries(invocation.values),
        flags: [...invocation.flags],
      },
      text: "echoed",
    }),
};

async function echoed(argv: readonly string[]): Promise<{ readonly exitCode: number; readonly output: string }> {
  return runCommandLine([echo], argv, contextFor({ workingDirectory: "/work" }));
}

test("the parser reads options before and after the command, inline values and --", async () => {
  const ran = await echoed(["--project", "p", "echo", "a", "--times=3", "--loud", "--json", "--", "--b"]);
  assert.equal(ran.exitCode, 0);
  assert.deepEqual(JSON.parse(ran.output), {
    project: "/work/p",
    positionals: ["a", "--b"],
    values: { project: "p", times: "3" },
    flags: ["loud", "json"],
  });
  const stdin = await echoed(["echo", "-", "--project=/elsewhere", "--json"]);
  assert.deepEqual(JSON.parse(stdin.output), {
    project: "/elsewhere",
    positionals: ["-"],
    values: { project: "/elsewhere" },
    flags: ["json"],
  });
});

test("the parser refuses unknown, repeated, missing and misplaced option values, and wrong argument counts", async () => {
  const cases: readonly (readonly [readonly string[], RegExp])[] = [
    [["echo", "a", "--quiet"], /The option --quiet is not an option of this command\./],
    [["echo", "a", "--times"], /The option --times needs a value\./],
    [["echo", "a", "--times", "--loud"], /The option --times needs a value\./],
    [["echo", "a", "--times", "1", "--times", "2"], /The option --times is given twice\./],
    [["echo", "a", "--loud=yes"], /The option --loud takes no value\./],
    [["echo"], /bay echo takes 1 to 2 arguments, but 0 were given\./],
    [["echo", "a", "b", "c"], /bay echo takes 1 to 2 arguments, but 3 were given\./],
  ];
  for (const [argv, message] of cases) {
    const ran = await echoed(argv);
    assert.equal(ran.exitCode, 2, argv.join(" "));
    assert.match(ran.output, message);
    assert.match(ran.output, /usage: echo <word>/);
  }
});

test("an option that needs a value takes the next word even when it starts with a dash", async () => {
  const cases: readonly (readonly [readonly string[], Readonly<Record<string, string>>])[] = [
    [["echo", "a", "--times", "-3", "--json"], { times: "-3" }],
    [["echo", "a", "--times", "--3", "--json"], { times: "--3" }],
    [["echo", "a", "--times", "-", "--json"], { times: "-" }],
    [["echo", "a", "--times", "--quiet", "--json"], { times: "--quiet" }],
  ];
  for (const [argv, values] of cases) {
    const ran = await echoed(argv);
    assert.equal(ran.exitCode, 0, argv.join(" "));
    assert.deepEqual(JSON.parse(ran.output), { project: "/work", positionals: ["a"], values, flags: ["json"] });
  }
});

test("an option that needs a value refuses an option of the command in its place", async () => {
  const cases: readonly (readonly [readonly string[], string])[] = [
    [["echo", "a", "--times", "--json"], "The option --times needs a value."],
    [["echo", "a", "--times", "--loud", "--json"], "The option --times needs a value."],
    [["echo", "a", "--times", "--project=p", "--json"], "The option --times needs a value."],
    [["echo", "a", "--times", "--", "b", "--json"], "The option --times needs a value."],
    [["echo", "a", "--times", "--1", "--times", "--2", "--json"], "The option --times is given twice."],
  ];
  for (const [argv, usage] of cases) {
    const ran = await echoed(argv);
    assert.equal(ran.exitCode, 2, argv.join(" "));
    assert.deepEqual(JSON.parse(ran.output), { ok: false, usage });
  }
});

test("every command prints its usage with --help and exits 0", async () => {
  for (const command of commands) {
    const ran = await bay([command.name, "--help"]);
    assert.equal(ran.exitCode, 0, command.name);
    assert.ok(ran.output.startsWith(`usage: bay ${command.usage} [--project <folder>] [--json]`), ran.output);
  }
});
