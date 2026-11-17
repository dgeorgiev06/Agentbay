import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, textField } from "../bay/json.ts";
import { eventsOfKind, ranCommands, withCommandKernel } from "./commands-fixture.ts";

const showingArguments = "JSON.stringify(process.argv.slice(1))";

function stdoutText(answer: Json): string | undefined {
  assert.equal(fieldOf(answer, "ok"), true, JSON.stringify(answer));
  return textField(fieldOf(fieldOf(answer, "value") ?? null, "stdout") ?? null, "text");
}

function exitCodeOf(answer: Json): Json | undefined {
  assert.equal(fieldOf(answer, "ok"), true, JSON.stringify(answer));
  return fieldOf(fieldOf(fieldOf(answer, "value") ?? null, "end") ?? null, "exitCode");
}

function ranWords(events: readonly { readonly detail: Json }[]): readonly Json[] {
  return events.map((event) => fieldOf(event.detail, "command") ?? null);
}

test("arguments that look like options come after the listed words, which stay first and unchanged", async () => {
  const listed = { show: { run: `node -p ${showingArguments} --` } };
  await withCommandKernel({ commands: listed }, async (kernel) => {
    const options = ["--force", "-c", "--output=/tmp/elsewhere", "--version"];
    const ran = await ranCommands(kernel, [{ name: "show", arguments: options }]);
    assert.equal(stdoutText(ran.answers[0] ?? null), '["--force","-c","--output=/tmp/elsewhere","--version"]\n');
    assert.deepEqual(ranWords(eventsOfKind(ran.run, "command")), [
      ["node", "-p", showingArguments, "--", "--force", "-c", "--output=/tmp/elsewhere", "--version"],
    ]);
  });
});

test("without -- at the end of the listed words, the same argument becomes an option of the program", async () => {
  const listed = { show: { run: `node -p ${showingArguments}` } };
  await withCommandKernel({ commands: listed }, async (kernel) => {
    const ran = await ranCommands(kernel, [{ name: "show", arguments: ["--version"] }]);
    assert.equal(stdoutText(ran.answers[0] ?? null), `${process.version}\n`);
  });
});

test("after --end-of-options a script's argument is a revision to git, never an option", async () => {
  const listed = {
    "commit-of": { run: "git rev-parse --verify --quiet --end-of-options" },
    "git-folder": { run: "git rev-parse" },
  };
  await withCommandKernel({ commands: listed }, async (kernel, kit) => {
    execFileSync("git", ["init", "--quiet"], { cwd: kit.root });
    const ran = await ranCommands(kernel, [
      { name: "commit-of", arguments: ["--git-dir"] },
      { name: "git-folder", arguments: ["--git-dir"] },
    ]);
    assert.deepEqual(
      ran.answers.map((answer) => [exitCodeOf(answer), stdoutText(answer)]),
      [
        [1, ""],
        [0, ".git\n"],
      ],
    );
    assert.deepEqual(ranWords(eventsOfKind(ran.run, "command")), [
      ["git", "rev-parse", "--verify", "--quiet", "--end-of-options", "--git-dir"],
      ["git", "rev-parse", "--git-dir"],
    ]);
  });
});

function refusalOf(answer: Json): Json {
  assert.equal(fieldOf(answer, "kind"), "refused", JSON.stringify(answer));
  return fieldOf(answer, "declared") ?? null;
}

test("an empty name and a name with path characters are unknown names, and nothing runs", async () => {
  const listed = { version: { run: "node --version" } };
  await withCommandKernel({ commands: listed }, async (kernel) => {
    const names = ["", "../version", "version/..", "./version", "/usr/bin/node", "components/base/version", "*"];
    const ran = await ranCommands(
      kernel,
      names.map((name) => ({ name, arguments: ["--version"] })),
    );
    assert.deepEqual(
      ran.answers.map((answer) => refusalOf(answer)),
      names.map(() => "its mode lists the commands: version"),
    );
    assert.deepEqual(eventsOfKind(ran.run, "command"), []);
  });
});

test("a script's first argument is never run as the program", async () => {
  const listed = { show: { run: `node -p ${showingArguments}` } };
  await withCommandKernel({ commands: listed }, async (kernel) => {
    const ran = await ranCommands(kernel, [{ name: "show", arguments: ["git", "status"] }]);
    assert.equal(stdoutText(ran.answers[0] ?? null), '["git","status"]\n');
  });
});
