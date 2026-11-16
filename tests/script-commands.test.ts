import assert from "node:assert/strict";
import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Effect, Json } from "../bay/contracts.ts";
import { fieldOf, textField } from "../bay/json.ts";
import { loadKernel, nodeKernelPorts } from "../bay/kernel.ts";
import { layoutOf } from "../bay/layout.ts";
import { makeCommandKit, ranCommands, withCommandKernel } from "./commands-fixture.ts";
import { testEnvironment } from "./kernel-fixture.ts";

test("a script of a base mode runs a command its mode lists and gets the exit code and output", async () => {
  await withCommandKernel({ commands: ["node --version"] }, async (kernel) => {
    const ran = await ranCommands(kernel, [{ command: ["node", "--version"] }]);
    const answer = ran.answers[0] ?? null;
    assert.equal(fieldOf(answer, "ok"), true, JSON.stringify(answer));
    const value = fieldOf(answer, "value") ?? null;
    assert.deepEqual(fieldOf(value, "end"), { how: "exited", exitCode: 0 });
    assert.match(textField(fieldOf(value, "stdout") ?? null, "text") ?? "", /^v\d+\.\d+\.\d+\n$/);
  });
});

function refusalMessage(answer: Json): string {
  assert.equal(fieldOf(answer, "kind"), "refused", JSON.stringify(answer));
  return textField(answer, "message") ?? "";
}

function unlistedSentence(command: string, listed: string, manifest: string): string {
  return (
    `The step 0 of action go asked to run the command ${command} in ., but its mode lists the commands: ${listed}, ` +
    "and a command must start with one of them, argument by argument. To allow it, add the command's leading " +
    `arguments under resources.commands in ${manifest}; only a mode under the kit's components/base/ may list commands.`
  );
}

test("a command that no listed prefix starts is refused", async () => {
  await withCommandKernel({ commands: ["git status"] }, async (kernel, kit) => {
    const ran = await ranCommands(kernel, [{ command: ["node", "--version"] }]);
    assert.equal(
      refusalMessage(ran.answers[0] ?? null),
      unlistedSentence('["node","--version"]', "git status", kit.manifest),
    );
  });
});

test("a prefix matches argument by argument, not as text", async () => {
  await withCommandKernel({ commands: ["git status"] }, async (kernel, kit) => {
    const ran = await ranCommands(kernel, [
      { command: ["git", "statusx"] },
      { command: ["git", "status --porcelain"] },
    ]);
    assert.deepEqual(
      ran.answers.map((answer) => refusalMessage(answer)),
      [
        unlistedSentence('["git","statusx"]', "git status", kit.manifest),
        unlistedSentence('["git","status --porcelain"]', "git status", kit.manifest),
      ],
    );
  });
});

test("an action that lacks one of the five effects may not run a command", async () => {
  const effects: readonly Effect[] = ["read", "write", "network", "spend"];
  await withCommandKernel({ commands: ["node --version"], effects }, async (kernel, kit) => {
    const ran = await ranCommands(kernel, [{ command: ["node", "--version"] }]);
    assert.equal(
      refusalMessage(ran.answers[0] ?? null),
      'The step 0 of action go asked to run the command ["node","--version"] in ., but the action go declares the ' +
        "effects: read, write, network, spend. A command can do anything its program can, so running one needs all " +
        `five effects; to allow it, add delete to actions.go.effects in ${kit.manifest}.`,
    );
  });
});

function folderSentence(folder: string, declared: string): string {
  return (
    `The step 0 of action go asked to run the command ["node","--version"] in ${folder}, but ${declared}. ` +
    'Give a folder of the project in the call to context.commands.run, such as "."; no manifest line allows another.'
  );
}

test("a working folder outside the project is refused, also through a link", async () => {
  await withCommandKernel({ commands: ["node --version"] }, async (kernel, kit) => {
    await symlink(tmpdir(), join(kit.root, "elsewhere"));
    const ran = await ranCommands(kernel, [
      { command: ["node", "--version"], folder: tmpdir() },
      { command: ["node", "--version"], folder: ".." },
      { command: ["node", "--version"], folder: "elsewhere" },
    ]);
    const outside = "a command runs only in a folder inside the project";
    assert.deepEqual(
      ran.answers.map((answer) => refusalMessage(answer)),
      [folderSentence(tmpdir(), outside), folderSentence("..", outside), folderSentence("elsewhere", outside)],
    );
  });
});

test("a working folder inside .agentbay/ is refused, also through a link", async () => {
  await withCommandKernel({ commands: ["node --version"] }, async (kernel, kit) => {
    await symlink(join(kit.root, ".agentbay"), join(kit.root, "state"));
    const ran = await ranCommands(kernel, [
      { command: ["node", "--version"], folder: ".agentbay" },
      { command: ["node", "--version"], folder: "state" },
    ]);
    const state = "a command never runs inside the kernel's state folder .agentbay/";
    assert.deepEqual(
      ran.answers.map((answer) => refusalMessage(answer)),
      [folderSentence(".agentbay", state), folderSentence("state", state)],
    );
  });
});

test("a mode outside components/base/ that lists a command does not load", async () => {
  const kit = await makeCommandKit({ commands: ["node --version"], tier: "modes" });
  try {
    const loaded = await loadKernel({
      layout: layoutOf({ kit: kit.root, project: kit.root }),
      ports: nodeKernelPorts(testEnvironment),
      environment: testEnvironment,
      platform: "linux",
    });
    assert.ok(!loaded.ok);
    assert.deepEqual(
      loaded.problems.map((problem) => problem.message),
      [
        "Mode command-prober lists the command node --version; a listed command can run code the agent wrote. " +
          "Only a mode under the kit's components/base/ may list commands.",
      ],
    );
  } finally {
    await kit.remove();
  }
});
