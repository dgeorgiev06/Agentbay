import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Effect, Json } from "../bay/contracts.ts";
import { fieldOf, textField } from "../bay/json.ts";
import { loadKernel, nodeKernelPorts } from "../bay/kernel.ts";
import { layoutOf } from "../bay/layout.ts";
import {
  eventsOfKind,
  isRunning,
  makeCommandKit,
  openCommandKernel,
  ranCommands,
  secretName,
  secretValue,
  withCommandKernel,
} from "./commands-fixture.ts";
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

function valueOf(answer: Json): Json {
  assert.equal(fieldOf(answer, "ok"), true, JSON.stringify(answer));
  return fieldOf(answer, "value") ?? null;
}

function stdoutOf(answer: Json): Json {
  return fieldOf(valueOf(answer), "stdout") ?? null;
}

function hashOfText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("a command runs with no shell: its arguments reach the program as written", async () => {
  await withCommandKernel({ commands: ["node -e"] }, async (kernel) => {
    const printing = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";
    const ran = await ranCommands(kernel, [
      { command: ["node", "-e", printing, "; echo injected", "$(echo injected)"] },
    ]);
    assert.deepEqual(stdoutOf(ran.answers[0] ?? null), { text: '["; echo injected","$(echo injected)"]', cut: false });
  });
});

test("a command past its time limit is stopped with what it started, and the script goes on", async () => {
  await withCommandKernel({ commands: ["node"] }, async (kernel) => {
    const lingering =
      "const sleeper = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });" +
      "console.log(process.pid, sleeper.pid); setInterval(() => {}, 1000);";
    const ran = await ranCommands(kernel, [
      { command: ["node", "-e", lingering], timeLimitSeconds: 1 },
      { command: ["node", "--version"] },
    ]);
    const stopped = valueOf(ran.answers[0] ?? null);
    assert.deepEqual(fieldOf(stopped, "end"), { how: "timed-out" });
    const pids = (textField(fieldOf(stopped, "stdout") ?? null, "text") ?? "").trim().split(" ").map(Number);
    assert.equal(pids.length, 2);
    assert.deepEqual(
      pids.map((pid) => isRunning(pid)),
      [false, false],
    );
    assert.deepEqual(fieldOf(valueOf(ran.answers[1] ?? null), "end"), { how: "exited", exitCode: 0 });
    assert.equal(ran.after, "the script went on");
    const took = fieldOf(eventsOfKind(ran.run, "command")[0]?.detail ?? null, "milliseconds");
    assert.ok(typeof took === "number" && took >= 1000 && took < 5000, JSON.stringify(took));
  });
});

test("a command's environment holds PATH and nothing else of the kernel's", async () => {
  const environment = { AGENTBAY_MADE_UP: "made-up-value", [`AGENTBAY_SECRET_${secretName}`]: secretValue };
  await withCommandKernel(
    { commands: ["node -e"] },
    async (kernel) => {
      const printing = "process.stdout.write(JSON.stringify(Object.keys(process.env)))";
      const ran = await ranCommands(kernel, [{ command: ["node", "-e", printing] }]);
      assert.deepEqual(stdoutOf(ran.answers[0] ?? null), { text: '["PATH"]', cut: false });
    },
    environment,
  );
});

test("a secret a command prints reaches the script redacted, and a secret argument is redacted in the event", async () => {
  const environment = { [`AGENTBAY_SECRET_${secretName}`]: secretValue };
  await withCommandKernel(
    { commands: ["node -e"] },
    async (kernel) => {
      const printing = "process.stdout.write(`token: ${process.argv[1]}`)";
      const ran = await ranCommands(kernel, [{ command: ["node", "-e", printing, "{secret}"] }], { withSecret: true });
      assert.deepEqual(ran.leaks, [false]);
      assert.deepEqual(stdoutOf(ran.answers[0] ?? null), { text: `token: [redacted:${secretName}]`, cut: false });
      const ranEvent = eventsOfKind(ran.run, "command")[0]?.detail ?? null;
      assert.deepEqual(fieldOf(ranEvent, "command"), ["node", "-e", printing, `[redacted:${secretName}]`]);
      assert.equal(JSON.stringify(ran.run.events).includes(secretValue), false);
    },
    environment,
  );
});

test("a command that writes more than the limit gives the end, says it was cut, and the event hashes all of it", async () => {
  await withCommandKernel({ commands: ["node -e"] }, async (kernel) => {
    const written = `${"a".repeat(100_000)}the end`;
    const ran = await ranCommands(kernel, [
      { command: ["node", "-e", 'process.stdout.write("a".repeat(100000) + "the end")'] },
    ]);
    assert.deepEqual(stdoutOf(ran.answers[0] ?? null), { text: written.slice(-65_536), cut: true });
    const ranEvent = eventsOfKind(ran.run, "command")[0]?.detail ?? null;
    assert.equal(fieldOf(ranEvent, "stdoutHash"), hashOfText(written));
  });
});

test("each command that ran and each that was refused is an event of the run", async () => {
  await withCommandKernel({ commands: ["node --version"] }, async (kernel, kit) => {
    const ran = await ranCommands(kernel, [{ command: ["node", "--version"] }, { command: ["git", "log"] }]);
    const ranEvents = eventsOfKind(ran.run, "command");
    assert.equal(ranEvents.length, 1);
    const detail = ranEvents[0]?.detail ?? null;
    const milliseconds = fieldOf(detail, "milliseconds");
    assert.ok(typeof milliseconds === "number" && milliseconds >= 0, JSON.stringify(detail));
    assert.deepEqual(detail, {
      step: "0",
      command: ["node", "--version"],
      folder: ".",
      end: { how: "exited", exitCode: 0 },
      milliseconds,
      stdoutHash: hashOfText(`${process.version}\n`),
      stderrHash: hashOfText(""),
    });
    assert.deepEqual(
      eventsOfKind(ran.run, "refused").map((event) => event.detail),
      [
        {
          resource: "commands",
          step: "0",
          message: unlistedSentence('["git","log"]', "node --version", kit.manifest),
          command: ["git", "log"],
          folder: ".",
        },
      ],
    );
  });
});

test("a listed prefix of only spaces matches no command", async () => {
  await withCommandKernel({ commands: [" "] }, async (kernel, kit) => {
    const ran = await ranCommands(kernel, [{ command: ["node", "--version"] }]);
    assert.equal(refusalMessage(ran.answers[0] ?? null), unlistedSentence('["node","--version"]', " ", kit.manifest));
  });
});

test("a time limit that is not above 0 seconds is refused", async () => {
  await withCommandKernel({ commands: ["node --version"] }, async (kernel) => {
    const ran = await ranCommands(kernel, [{ command: ["node", "--version"], timeLimitSeconds: 0 }]);
    assert.equal(
      refusalMessage(ran.answers[0] ?? null),
      'The step 0 of action go asked to run the command ["node","--version"] in . with a time limit of 0 seconds, ' +
        "but a command's time limit is a number of seconds above 0. Give timeLimitSeconds as a number above 0 in " +
        "the call to context.commands.run.",
    );
  });
});

test("a listed program that cannot start fails, and the attempt is an event", async () => {
  await withCommandKernel({ commands: ["agentbay-no-such-program"] }, async (kernel) => {
    const ran = await ranCommands(kernel, [{ command: ["agentbay-no-such-program"] }]);
    assert.deepEqual(ran.answers, [
      {
        ok: false,
        kind: "failed",
        message: 'The command ["agentbay-no-such-program"] could not start: spawn agentbay-no-such-program ENOENT',
      },
    ]);
    const detail = eventsOfKind(ran.run, "command")[0]?.detail ?? null;
    assert.deepEqual(fieldOf(detail, "end"), { how: "not-started", reason: "spawn agentbay-no-such-program ENOENT" });
  });
});

test("a request whose command is not a list of texts stops the script", async () => {
  const kit = await makeCommandKit({ commands: ["node"] });
  try {
    const kernel = await openCommandKernel(kit);
    try {
      const input = { requests: [{ command: ["node", 1], folder: ".", timeLimitSeconds: 30 }] };
      const started = await kernel.runs.start({ action: "command-prober.go" }, input);
      assert.ok(started.ok, JSON.stringify(started));
      assert.deepEqual(started.value.state, {
        status: "failed",
        reason: "The script sent a line that is not a valid message.",
      });
    } finally {
      kernel.close();
    }
  } finally {
    await kit.remove();
  }
});
