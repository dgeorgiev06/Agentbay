import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import { trustRecordFiles } from "./system-fixture.ts";

const version = { version: { run: "node --version" } };

const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

const evaluate = { evaluate: { run: "node -e" } };

test("a script of a base mode runs a command its mode lists and gets the exit code and output", async () => {
  await withCommandKernel({ commands: version }, async (kernel) => {
    const ran = await ranCommands(kernel, [{ name: "version" }]);
    const answer = ran.answers[0] ?? null;
    assert.equal(fieldOf(answer, "ok"), true, JSON.stringify(answer));
    const value = fieldOf(answer, "value") ?? null;
    assert.deepEqual(fieldOf(value, "end"), { how: "exited", exitCode: 0 });
    assert.match(textField(fieldOf(value, "stdout") ?? null, "text") ?? "", /^v\d+\.\d+\.\d+\n$/);
  });
});

const showingArguments = "JSON.stringify(process.argv.slice(1))";

test("a named command runs the listed words followed by the script's arguments", async () => {
  await withCommandKernel({ commands: { show: { run: `node -p ${showingArguments}` } } }, async (kernel) => {
    const ran = await ranCommands(kernel, [{ name: "show", arguments: ["first", "second word"] }]);
    assert.deepEqual(stdoutOf(ran.answers[0] ?? null), { text: '["first","second word"]\n', cut: false });
    assert.deepEqual(fieldOf(eventsOfKind(ran.run, "command")[0]?.detail ?? null, "command"), [
      "node",
      "-p",
      showingArguments,
      "first",
      "second word",
    ]);
  });
});

function refusalMessage(answer: Json): string {
  assert.equal(fieldOf(answer, "kind"), "refused", JSON.stringify(answer));
  return textField(answer, "message") ?? "";
}

function unknownSentence(asked: string, listed: string, manifest: string): string {
  const name = asked.split(" with ")[0] ?? "";
  return (
    `The step 0 of action go asked to run the listed command ${asked} in ., but its mode lists the commands: ` +
    `${listed}. To allow it, list ${name} under resources.commands in ${manifest} with the words it runs and its ` +
    "effects; a mode outside the kit's components/base/ is granted the commands it lists only when the owner " +
    "trusts its list."
  );
}

test("a name the mode does not list is refused with a sentence that lists the mode's names", async () => {
  await withCommandKernel({ commands: { changes: { run: "git status" }, ...version } }, async (kernel, kit) => {
    const ran = await ranCommands(kernel, [{ name: "log", arguments: ["-1"] }]);
    assert.equal(
      refusalMessage(ran.answers[0] ?? null),
      unknownSentence('log with ["-1"]', "changes, version", kit.manifest),
    );
    assert.deepEqual(eventsOfKind(ran.run, "command"), []);
  });
});

test("a name matches exactly: case, a prefix, a longer name and the program's own name are refused", async () => {
  await withCommandKernel({ commands: version }, async (kernel, kit) => {
    const names = ["Version", "vers", "versions", "version ", "node"];
    const ran = await ranCommands(
      kernel,
      names.map((name) => ({ name })),
    );
    assert.deepEqual(
      ran.answers.map((answer) => refusalMessage(answer)),
      names.map((name) => unknownSentence(`${name} with []`, "version", kit.manifest)),
    );
    assert.deepEqual(eventsOfKind(ran.run, "command"), []);
  });
});

type Lacking = { readonly declared: string; readonly listed: string; readonly missing: string };

function lackingSentence({ declared, listed, missing }: Lacking, manifest: string): string {
  return (
    "The step 0 of action go asked to run the listed command version with [] in ., but the action go declares the " +
    `effects: ${declared}, and version is listed with: ${listed}. To allow it, add ${missing} to actions.go.effects ` +
    `in ${manifest}.`
  );
}

test("an action that lacks one of the command's effects may not run it, and nothing runs", async () => {
  const effects: readonly Effect[] = ["read", "network", "spend", "delete"];
  await withCommandKernel({ commands: version, effects }, async (kernel, kit) => {
    const ran = await ranCommands(kernel, [{ name: "version" }]);
    assert.equal(
      refusalMessage(ran.answers[0] ?? null),
      lackingSentence(
        { declared: "read, network, spend, delete", listed: "read, write, network, spend, delete", missing: "write" },
        kit.manifest,
      ),
    );
    assert.deepEqual(eventsOfKind(ran.run, "command"), []);
  });
});

test("an action that declares no effects is told the first effect the command is listed with", async () => {
  const listed = { version: { run: "node --version", effects: ["spend", "read"] satisfies Effect[] } };
  await withCommandKernel({ commands: listed, effects: [] }, async (kernel, kit) => {
    const ran = await ranCommands(kernel, [{ name: "version" }]);
    assert.equal(
      refusalMessage(ran.answers[0] ?? null),
      lackingSentence({ declared: "none", listed: "spend, read", missing: "spend" }, kit.manifest),
    );
  });
});

test("an action that declares every effect of the command runs it, with no other effect needed", async () => {
  const listed = { version: { run: "node --version", effects: ["read", "write"] satisfies Effect[] } };
  await withCommandKernel({ commands: listed, effects: ["write", "read"] }, async (kernel) => {
    const ran = await ranCommands(kernel, [{ name: "version" }]);
    assert.deepEqual(fieldOf(valueOf(ran.answers[0] ?? null), "end"), { how: "exited", exitCode: 0 });
  });
  await withCommandKernel({ commands: listed, effects: ["read"] }, async (kernel, kit) => {
    const ran = await ranCommands(kernel, [{ name: "version" }]);
    assert.equal(
      refusalMessage(ran.answers[0] ?? null),
      lackingSentence({ declared: "read", listed: "read, write", missing: "write" }, kit.manifest),
    );
  });
});

test("a command listed with only the read effect runs under an action that declares only read", async () => {
  const listed = { version: { run: "node --version", effects: ["read"] satisfies Effect[] } };
  await withCommandKernel({ commands: listed, effects: ["read"] }, async (kernel) => {
    const ran = await ranCommands(kernel, [{ name: "version" }]);
    assert.deepEqual(fieldOf(valueOf(ran.answers[0] ?? null), "end"), { how: "exited", exitCode: 0 });
    assert.deepEqual(fieldOf(eventsOfKind(ran.run, "command")[0]?.detail ?? null, "name"), "version");
  });
});

function folderSentence(folder: string, declared: string): string {
  return (
    `The step 0 of action go asked to run the listed command version with [] in ${folder}, but ${declared}. ` +
    'Give a folder of the project in the call to context.commands.run, such as "."; no manifest line allows another.'
  );
}

test("a working folder outside the project is refused, also through a link", async () => {
  await withCommandKernel({ commands: version }, async (kernel, kit) => {
    await symlink(tmpdir(), join(kit.root, "elsewhere"));
    const ran = await ranCommands(kernel, [
      { name: "version", folder: tmpdir() },
      { name: "version", folder: ".." },
      { name: "version", folder: "elsewhere" },
    ]);
    const outside = "a command runs only in a folder inside the project";
    assert.deepEqual(
      ran.answers.map((answer) => refusalMessage(answer)),
      [folderSentence(tmpdir(), outside), folderSentence("..", outside), folderSentence("elsewhere", outside)],
    );
  });
});

test("a working folder inside .agentbay/ is refused, also through a link", async () => {
  await withCommandKernel({ commands: version }, async (kernel, kit) => {
    await symlink(join(kit.root, ".agentbay"), join(kit.root, "state"));
    const ran = await ranCommands(kernel, [
      { name: "version", folder: ".agentbay" },
      { name: "version", folder: "state" },
    ]);
    const state = "a command never runs inside the kernel's state folder .agentbay/";
    assert.deepEqual(
      ran.answers.map((answer) => refusalMessage(answer)),
      [folderSentence(".agentbay", state), folderSentence("state", state)],
    );
  });
});

test("a mode outside components/base/ that lists a command loads without it, and its script is told the owner does not trust its list", async () => {
  const kit = await makeCommandKit({ commands: version, tier: "modes" });
  try {
    const kernel = await openCommandKernel(kit);
    try {
      const ran = await ranCommands(kernel, [{ name: "version" }]);
      assert.equal(
        refusalMessage(ran.answers[0] ?? null),
        "The step 0 of action go asked to run the listed command version with [] in ., but the owner does not " +
          "trust the list of mode command-prober, so none of its commands or throwaway folders is granted. The " +
          "owner reads the list and decides with: bay approve --trust command-prober.",
      );
      assert.deepEqual(eventsOfKind(ran.run, "command"), []);
    } finally {
      kernel.close();
    }
  } finally {
    await kit.remove();
  }
});

test("a mode outside components/base/ whose list the owner trusts runs its listed command", async () => {
  const kit = await makeCommandKit({ commands: version, tier: "modes" });
  try {
    const list = {
      mode: "command-prober",
      commands: [{ name: "version", words: ["node", "--version"], effects: everyEffect }],
      commandsStartWith: [],
      throwaway: [],
    };
    for (const [path, text] of Object.entries(trustRecordFiles(list))) {
      await mkdir(dirname(join(kit.root, path)), { recursive: true });
      await writeFile(join(kit.root, path), text, "utf8");
    }
    const kernel = await openCommandKernel(kit);
    try {
      const ran = await ranCommands(kernel, [{ name: "version" }]);
      assert.match(textField(stdoutOf(ran.answers[0] ?? null), "text") ?? "", /^v\d+\.\d+\.\d+\n$/);
    } finally {
      kernel.close();
    }
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
  await withCommandKernel({ commands: evaluate }, async (kernel) => {
    const printing = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";
    const ran = await ranCommands(kernel, [
      { name: "evaluate", arguments: [printing, "; echo injected", "$(echo injected)"] },
    ]);
    assert.deepEqual(stdoutOf(ran.answers[0] ?? null), { text: '["; echo injected","$(echo injected)"]', cut: false });
  });
});

test("a command past its time limit is stopped with what it started, and the script goes on", async () => {
  await withCommandKernel({ commands: { ...evaluate, ...version } }, async (kernel) => {
    const lingering =
      "const sleeper = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });" +
      "console.log(process.pid, sleeper.pid); setInterval(() => {}, 1000);";
    const ran = await ranCommands(kernel, [
      { name: "evaluate", arguments: [lingering], timeLimitSeconds: 1 },
      { name: "version" },
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
    assert.equal(fieldOf(stopped, "milliseconds"), took);
  });
});

test("a command reads the input the script gives on its standard input, and the event records the input's hash", async () => {
  await withCommandKernel({ commands: evaluate }, async (kernel) => {
    const shouting =
      "let text = ''; process.stdin.setEncoding('utf8').on('data', (part) => { text += part; })" +
      ".on('end', () => process.stdout.write(`[${text.toUpperCase()}]`))";
    const ran = await ranCommands(kernel, [
      { name: "evaluate", arguments: [shouting], input: "set aside\n" },
      { name: "evaluate", arguments: [shouting] },
    ]);
    assert.deepEqual(stdoutOf(ran.answers[0] ?? null), { text: "[SET ASIDE\n]", cut: false });
    assert.deepEqual(stdoutOf(ran.answers[1] ?? null), { text: "[]", cut: false });
    const details = eventsOfKind(ran.run, "command").map((event) => event.detail);
    assert.deepEqual(
      details.map((detail) => fieldOf(detail, "inputHash") ?? "none"),
      [hashOfText("set aside\n"), "none"],
    );
  });
});

test("a command's environment holds PATH and nothing else of the kernel's", async () => {
  const environment = { AGENTBAY_MADE_UP: "made-up-value", [`AGENTBAY_SECRET_${secretName}`]: secretValue };
  await withCommandKernel(
    { commands: evaluate },
    async (kernel) => {
      const printing = "process.stdout.write(JSON.stringify(Object.keys(process.env)))";
      const ran = await ranCommands(kernel, [{ name: "evaluate", arguments: [printing] }]);
      assert.deepEqual(stdoutOf(ran.answers[0] ?? null), { text: '["PATH"]', cut: false });
    },
    environment,
  );
});

test("a secret a command prints reaches the script redacted, and a secret argument is redacted in the event", async () => {
  const environment = { [`AGENTBAY_SECRET_${secretName}`]: secretValue };
  await withCommandKernel(
    { commands: evaluate },
    async (kernel) => {
      const printing = "process.stdout.write(`token: ${process.argv[1]}`)";
      const asked = [{ name: "evaluate", arguments: [printing, "{secret}"] }];
      const ran = await ranCommands(kernel, asked, { withSecret: true });
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
  await withCommandKernel({ commands: evaluate }, async (kernel) => {
    const written = `${"a".repeat(100_000)}the end`;
    const ran = await ranCommands(kernel, [
      { name: "evaluate", arguments: ['process.stdout.write("a".repeat(100000) + "the end")'] },
    ]);
    assert.deepEqual(stdoutOf(ran.answers[0] ?? null), { text: written.slice(-65_536), cut: true });
    const ranEvent = eventsOfKind(ran.run, "command")[0]?.detail ?? null;
    assert.equal(fieldOf(ranEvent, "stdoutHash"), hashOfText(written));
  });
});

test("each command that ran and each that was refused is an event of the run", async () => {
  await withCommandKernel({ commands: version }, async (kernel, kit) => {
    const ran = await ranCommands(kernel, [{ name: "version" }, { name: "log", arguments: ["-1"] }]);
    const ranEvents = eventsOfKind(ran.run, "command");
    assert.equal(ranEvents.length, 1);
    const detail = ranEvents[0]?.detail ?? null;
    const milliseconds = fieldOf(detail, "milliseconds");
    assert.ok(typeof milliseconds === "number" && milliseconds >= 0, JSON.stringify(detail));
    assert.deepEqual(detail, {
      step: "0",
      name: "version",
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
          message: unknownSentence('log with ["-1"]', "version", kit.manifest),
          name: "log",
          arguments: ["-1"],
          folder: ".",
        },
      ],
    );
  });
});

test("a listed command whose words are only spaces does not load", async () => {
  const kit = await makeCommandKit({ commands: { blank: { run: " " } } });
  try {
    const loaded = await loadKernel({
      layout: layoutOf({ kit: kit.root, project: kit.root }),
      ports: nodeKernelPorts(testEnvironment),
      environment: testEnvironment,
      platform: "linux",
    });
    assert.ok(!loaded.ok);
    assert.deepEqual(
      loaded.problems.map((problem) => [problem.path, problem.message]),
      [
        [
          "/resources/commands/blank/run",
          "resources.commands.blank.run is not in the expected form. Expected: The command's fixed words, " +
            "separated by spaces. When the mode gives commandsStartWith, they follow those words; otherwise the " +
            "first word is the program. A script names the command and gives only the arguments that come after.",
        ],
      ],
    );
  } finally {
    await kit.remove();
  }
});

test("a time limit that is not above 0 seconds is refused", async () => {
  await withCommandKernel({ commands: version }, async (kernel) => {
    const ran = await ranCommands(kernel, [{ name: "version", timeLimitSeconds: 0 }]);
    assert.equal(
      refusalMessage(ran.answers[0] ?? null),
      "The step 0 of action go asked to run the listed command version with [] in . with a time limit of 0 seconds, " +
        "but a command's time limit is a number of seconds above 0. Give timeLimitSeconds as a number above 0 in " +
        "the call to context.commands.run.",
    );
  });
});

test("a listed program that cannot start fails, and the attempt is an event", async () => {
  await withCommandKernel({ commands: { missing: { run: "agentbay-no-such-program" } } }, async (kernel) => {
    const ran = await ranCommands(kernel, [{ name: "missing" }]);
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

async function stoppedBy(request: Json): Promise<Json> {
  const kit = await makeCommandKit({ commands: version });
  try {
    const kernel = await openCommandKernel(kit);
    try {
      const started = await kernel.runs.start({ action: "command-prober.go" }, { requests: [request] });
      assert.ok(started.ok, JSON.stringify(started));
      return started.value.state;
    } finally {
      kernel.close();
    }
  } finally {
    await kit.remove();
  }
}

test("a request whose name is not text, or whose arguments are not a list of texts, stops the script with the field's sentence", async () => {
  const stopped = (reason: string): Json => ({ status: "failed", reason });
  const asked = { folder: ".", timeLimitSeconds: 30 };
  assert.deepEqual(
    await stoppedBy({ ...asked, name: "version", arguments: ["--version", 1] }),
    stopped("The field arguments[1] in the request for commands.run is not text."),
  );
  assert.deepEqual(
    await stoppedBy({ ...asked, name: "version", arguments: "--version" }),
    stopped("The field arguments in the request for commands.run is not a list of text."),
  );
  assert.deepEqual(
    await stoppedBy({ ...asked, name: "version" }),
    stopped("The field arguments is missing from the request for commands.run. It must be a list of text."),
  );
  assert.deepEqual(
    await stoppedBy({ ...asked, name: ["version"], arguments: [] }),
    stopped("The field name in the request for commands.run is not text."),
  );
  assert.deepEqual(
    await stoppedBy({ ...asked, arguments: [] }),
    stopped("The field name is missing from the request for commands.run. It must be text."),
  );
});
