import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { KernelPorts } from "../bay/kernel.ts";
import { layoutOf } from "../bay/layout.ts";
import { loadSystem } from "../bay/manifests/manifests.ts";
import { nodeFileSystem } from "../bay/node-ports.ts";
import { isRecord } from "../bay/json.ts";
import { bay, fakeTerminal } from "./cli-fixture.ts";
import { kit, makeProject, type Project, type ProjectOptions } from "./project-fixture.ts";

type Resources = {
  readonly commandsStartWith?: string;
  readonly commands: Readonly<Record<string, { readonly run: string; readonly effects: readonly string[] }>>;
  readonly files?: { readonly throwaway: readonly string[] };
};

const goResources: Resources = {
  commandsStartWith: "go",
  commands: {
    vet: { run: "vet ./...", effects: ["read"] },
    build: { run: "build ./...", effects: ["read", "write"] },
    "run-tests": { run: "test -json", effects: ["read", "write", "network"] },
  },
  files: { throwaway: [".forge/go-cache/"] },
};

const folder = "components/modes/go-toolchain";

const emptySchema = '{ "type": "object", "additionalProperties": false }\n';

function manifestText(resources: Resources): string {
  const manifest = {
    name: "go-toolchain",
    version: "1.0.0",
    description: "Runs the go tool for a project written in Go.",
    actions: {
      vet: {
        description: "When the owner wants go vet run.",
        input: "schemas/empty.json",
        output: "schemas/empty.json",
        effects: ["read"],
        run: [{ script: "scripts/vet.ts" }],
      },
    },
    resources,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function withGoToolchain(
  options: ProjectOptions & { readonly resources?: Resources },
  body: (project: Project) => Promise<void>,
): Promise<void> {
  const project = await makeProject(options);
  try {
    await project.write(`${folder}/mode.yaml`, manifestText(options.resources ?? goResources));
    await project.write(`${folder}/scripts/vet.ts`, "export {};\n");
    await project.write(`${folder}/schemas/empty.json`, emptySchema);
    await body(project);
  } finally {
    await project.remove();
  }
}

const at = new Date("2026-11-17T14:02:00.000Z");

const ports: Partial<KernelPorts> = { clock: { now: () => at } };

function trustArgv(project: Project, ...more: readonly string[]): readonly string[] {
  return ["approve", "--trust", "go-toolchain", ...more, "--project", project.root];
}

function atTerminal(answer: string): {
  readonly terminal: ReturnType<typeof fakeTerminal>;
  readonly ports: typeof ports;
} {
  return { terminal: fakeTerminal({ interactive: true, answer }), ports };
}

async function recordText(project: Project): Promise<string | undefined> {
  try {
    return await project.read(".agentbay/trust.json");
  } catch {
    return undefined;
  }
}

async function listTrustState(project: Project, mode = "go-toolchain"): Promise<string | undefined> {
  const system = await loadSystem(nodeFileSystem, layoutOf({ kit, project: project.root }));
  assert.ok(system.ok, JSON.stringify(system));
  return system.value.modes.get(mode)?.grants.listTrust.state;
}

const goHash = "95f6a0ecfe025e1f026ea7934a5826a6912681a02d7e04170948847b6a25f060";

const goCard = [
  "Trust the mode go-toolchain?",
  "  components/modes/go-toolchain",
  "",
  "It lists 3 commands. Each runs unconfined.",
  "  build      go build ./...",
  "             read, write",
  "  run-tests  go test -json",
  "             read, write, network",
  "  vet        go vet ./...",
  "             read",
  "It names 1 throwaway folder. The kernel",
  "makes and removes folders there.",
  "  .forge/go-cache",
  "",
  "The effects are the mode's own claim.",
  "Its scripts choose the arguments.",
  "You trust exactly this list. Any change",
  "to it asks you again.",
  "",
  "hash 95f6a0ecfe02",
].join("\n");

const notTerminalSentence =
  "Nothing changed. Trust is the owner's to give: at a terminal, or, if agentbay.config.yaml lists chat under " +
  `approvals.from, with --hash ${goHash} --via chat --quote "<the owner's exact words>".`;

test("where the shell is not a terminal, bay approve --trust prints the card, says how trust is given, and changes nothing", async () => {
  await withGoToolchain({}, async (project) => {
    const ran = await bay(trustArgv(project));
    assert.equal(ran.exitCode, 1);
    assert.equal(ran.output, `${goCard}\n\n${notTerminalSentence}`);
    assert.equal(await recordText(project), undefined);
    assert.equal(await listTrustState(project), "never trusted");
  });
});

const scriptHash = "0d73a05028df8331cd285684598d5d32f0ab709593574ddb02022b1df87220ae";

const firstScripts: Readonly<Record<string, string>> = { "scripts/vet.ts": scriptHash };

const trustDay = "2026-11-17T14:02:00.000Z";

function recordWith(by: string, scripts = firstScripts, day = trustDay): string {
  const scriptLines = Object.entries(scripts).map(([path, hash]) => `        "${path}": "${hash}"`);
  return [
    "{",
    '  "version": 1,',
    '  "modes": {',
    '    "go-toolchain": {',
    '      "list": {',
    '        "mode": "go-toolchain",',
    '        "commands": [',
    "          {",
    '            "name": "vet",',
    '            "words": [',
    '              "go",',
    '              "vet",',
    '              "./..."',
    "            ],",
    '            "effects": [',
    '              "read"',
    "            ]",
    "          },",
    "          {",
    '            "name": "build",',
    '            "words": [',
    '              "go",',
    '              "build",',
    '              "./..."',
    "            ],",
    '            "effects": [',
    '              "read",',
    '              "write"',
    "            ]",
    "          },",
    "          {",
    '            "name": "run-tests",',
    '            "words": [',
    '              "go",',
    '              "test",',
    '              "-json"',
    "            ],",
    '            "effects": [',
    '              "read",',
    '              "write",',
    '              "network"',
    "            ]",
    "          }",
    "        ],",
    '        "commandsStartWith": [',
    '          "go"',
    "        ],",
    '        "throwaway": [',
    '          ".forge/go-cache"',
    "        ]",
    "      },",
    `      "hash": "${goHash}",`,
    '      "scripts": {',
    scriptLines.join(",\n"),
    "      },",
    `      "at": "${day}",`,
    `      "by": ${JSON.stringify(by)}`,
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
}

test("at a terminal, yes writes the trust record for the owner only, and the mode's list is in force", async () => {
  await withGoToolchain({}, async (project) => {
    const changes = atTerminal("yes");
    const ran = await bay(trustArgv(project), changes);
    assert.equal(ran.exitCode, 0, ran.output);
    assert.deepEqual(changes.terminal.asked, [`${goCard}\nType yes to trust it: `]);
    assert.equal(
      ran.output,
      "go-toolchain is trusted: 3 commands, 1 throwaway folder. Its scripts may run its commands from the next step.",
    );
    assert.equal(await recordText(project), recordWith("owner at the terminal"));
    assert.equal((await stat(join(project.root, ".agentbay/trust.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(project.root, ".agentbay"))).mode & 0o777, 0o700);
    assert.equal(await listTrustState(project), "trusted");
  });
});

test("the hash on the card is the start of the hash recorded", async () => {
  await withGoToolchain({}, async (project) => {
    await bay(trustArgv(project), atTerminal("yes"));
    const recorded = /"hash": "([0-9a-f]{64})"/.exec((await recordText(project)) ?? "")?.[1] ?? "";
    const shown = /^hash ([0-9a-f]+)$/m.exec(goCard)?.[1] ?? "";
    assert.equal(shown.length, 12);
    assert.ok(recorded.startsWith(shown), `${recorded} does not start with ${shown}`);
  });
});

test("at a terminal, anything but yes changes nothing and says so", async () => {
  await withGoToolchain({}, async (project) => {
    for (const answer of ["y", "Yes please", "yes, trust it", "", "no"]) {
      const ran = await bay(trustArgv(project), atTerminal(answer));
      assert.deepEqual([ran.exitCode, ran.output], [1, "Not confirmed; nothing changed."], answer);
    }
    assert.equal(await recordText(project), undefined);
    assert.equal(await listTrustState(project), "never trusted");
  });
});

async function assertChatOff(project: Project, hash: string): Promise<void> {
  const ran = await bay(trustArgv(project, "--via", "chat", "--hash", hash, "--quote", "yes, trust go-toolchain"));
  assert.equal(ran.exitCode, 1);
  assert.equal(
    ran.output,
    [
      "Trust from chat is off: approvals.from in agentbay.config.yaml lists terminal.",
      "  fix: The owner answers the card at a terminal: bay approve --trust go-toolchain. Only the owner changes " +
        "approvals.from.",
    ].join("\n"),
  );
}

test("from chat, trust is refused when the config does not list chat, whatever the hash and the words", async () => {
  await withGoToolchain({}, async (project) => {
    await assertChatOff(project, goHash);
    assert.equal(await recordText(project), undefined);
  });
});

function chatRefusals(hash: string): readonly (readonly [readonly string[], string])[] {
  const quote = "yes, trust go-toolchain";
  const otherHash = "b4385d2b5acb3c998484d53e632789fc661722c3c18743f99a75c94ed61403ed";
  return [
    [
      ["--hash", otherHash, "--quote", quote],
      `The hash ${otherHash} is not the hash on the card for the mode go-toolchain now, so nothing changed.\n` +
        "  fix: Show the owner the card again: bay approve --trust go-toolchain.",
    ],
    [
      ["--hash", hash.slice(0, 12), "--quote", quote],
      `The hash ${hash.slice(0, 12)} is the short form on the card; trust from chat needs the full hash.\n` +
        "  fix: The full hash is printed when bay approve --trust go-toolchain runs where its input is not a terminal.",
    ],
    [
      ["--hash", hash, "--quote", "yes, trust it"],
      'The owner\'s words "yes, trust it" do not name the mode go-toolchain; an answer from chat counts only in ' +
        "words that name the mode.\n" +
        "  fix: Ask the owner to answer the card in words that name go-toolchain.",
    ],
  ];
}

async function assertChatRefusals(project: Project, hash: string): Promise<void> {
  for (const [more, output] of chatRefusals(hash)) {
    const ran = await bay(trustArgv(project, "--via", "chat", ...more));
    assert.deepEqual([ran.exitCode, ran.output], [1, output]);
  }
}

test("from chat, trust is refused for the hash of another list, for the short hash, and for words that do not name the mode", async () => {
  await withGoToolchain({ approvalsFrom: ["terminal", "chat"] }, async (project) => {
    await assertChatRefusals(project, goHash);
    assert.equal(await recordText(project), undefined);
  });
});

test("from chat, with chat listed, the full hash and words that name the mode, trust is given and the words are recorded", async () => {
  await withGoToolchain({ approvalsFrom: ["chat"] }, async (project) => {
    const quote = "Yes, trust go-toolchain";
    const ran = await bay(trustArgv(project, "--via", "chat", "--hash", goHash, "--quote", quote), { ports });
    assert.equal(ran.exitCode, 0, ran.output);
    assert.equal(await recordText(project), recordWith('owner via chat, quoted: "Yes, trust go-toolchain"'));
    assert.equal(await listTrustState(project), "trusted");
  });
});

const changedResources: Resources = {
  commandsStartWith: "go",
  commands: {
    vet: { run: "vet ./...", effects: ["read"] },
    build: { run: "build ./...", effects: ["read", "write", "network"] },
    "run-tests": { run: "test -json -race", effects: ["read", "write", "network"] },
    bench: { run: "test -bench .", effects: ["read", "write"] },
  },
  files: { throwaway: [".forge/go-cache/", ".forge/bench-cache/"] },
};

const fmtResources: Resources = {
  ...goResources,
  commands: { ...goResources.commands, fmt: { run: "fmt ./...", effects: ["read", "write"] } },
};

const differenceCard = [
  "The mode go-toolchain changed its list.",
  "You trusted it on 2026-11-17, as the owner",
  "at the terminal. None of it runs until you",
  "decide.",
  "",
  "  + bench      go test -bench .",
  "               read, write",
  "  ~ build      go build ./...",
  "               read, write, network",
  "          was  read, write",
  "  - fmt        go fmt ./...",
  "               read, write",
  "  ~ run-tests  go test -json -race",
  "          was  go test -json",
  "               read, write, network",
  "  + folder .forge/bench-cache",
  "  = as before: vet, folder .forge/go-cache",
  "",
  "2 of its script files changed as well.",
  "",
  "hash 400bccef6110",
].join("\n");

test("after the list changed, the card shows the difference, and yes puts the new list in force", async () => {
  await withGoToolchain({ resources: fmtResources }, async (project) => {
    assert.equal((await bay(trustArgv(project), atTerminal("yes"))).exitCode, 0);
    await project.write(`${folder}/mode.yaml`, manifestText(changedResources));
    await project.write(`${folder}/scripts/vet.ts`, "export const changed = true;\n");
    await project.write(`${folder}/scripts/bench.ts`, "export {};\n");
    await project.write(`${folder}/tests/vet.test.ts`, "export {};\n");
    assert.equal(await listTrustState(project), "changed");
    const shown = await bay(trustArgv(project));
    assert.equal(shown.exitCode, 1);
    assert.equal(shown.output.split("\n\nNothing changed.")[0], differenceCard);
    const changes = atTerminal("yes");
    const trusted = await bay(trustArgv(project), changes);
    assert.equal(trusted.exitCode, 0, trusted.output);
    assert.deepEqual(changes.terminal.asked, [`${differenceCard}\nType yes to trust the new list: `]);
    assert.equal(await listTrustState(project), "trusted");
  });
});

test("with no script file changed, a trusted mode is already trusted; a changed script file leaves the trust standing", async () => {
  await withGoToolchain({}, async (project) => {
    await bay(trustArgv(project), atTerminal("yes"));
    const again = await bay(trustArgv(project), atTerminal("yes"));
    assert.equal(again.exitCode, 1);
    assert.equal(
      again.output,
      "The mode go-toolchain is already trusted for this list. You trusted it on 2026-11-17, as the owner at the " +
        "terminal. Nothing changed.",
    );
    await project.write(`${folder}/scripts/vet.ts`, "export const changed = true;\n");
    assert.equal(await listTrustState(project), "trusted");
  });
});

const withdrawCard = [
  "Withdraw trust from the mode go-toolchain?",
  "Its 3 commands and 1 throwaway folder stop",
  "being granted. A run that needs them is",
  "refused until you trust the mode again.",
  "",
  "hash 95f6a0ecfe02",
].join("\n");

test("--reject withdraws trust only after a yes, with its card", async () => {
  await withGoToolchain({}, async (project) => {
    await bay(trustArgv(project), atTerminal("yes"));
    const trusted = await recordText(project);
    const piped = await bay(trustArgv(project, "--reject"));
    assert.equal(piped.exitCode, 1);
    assert.equal(
      piped.output,
      `${withdrawCard}\n\nNothing changed. Withdrawing trust is the owner's to do: at a terminal, or, if ` +
        `agentbay.config.yaml lists chat under approvals.from, with --reject --hash ${goHash} --via chat --quote ` +
        `"<the owner's exact words>".`,
    );
    const declined = await bay(trustArgv(project, "--reject"), atTerminal("no"));
    assert.deepEqual([declined.exitCode, declined.output], [1, "Not confirmed; nothing changed."]);
    assert.equal(await recordText(project), trusted);
    const changes = atTerminal("yes");
    const withdrawn = await bay(trustArgv(project, "--reject"), changes);
    assert.deepEqual(changes.terminal.asked, [`${withdrawCard}\nType yes to withdraw: `]);
    assert.deepEqual(
      [withdrawn.exitCode, withdrawn.output],
      [0, "Trust withdrawn from go-toolchain. From the next step, its scripts may not run its commands."],
    );
    assert.equal(await recordText(project), '{\n  "version": 1,\n  "modes": {}\n}\n');
    assert.equal(await listTrustState(project), "never trusted");
    const nothing = await bay(trustArgv(project, "--reject"), atTerminal("yes"));
    assert.deepEqual(
      [nothing.exitCode, nothing.output],
      [1, "The mode go-toolchain is not trusted, so there is no trust to withdraw."],
    );
  });
});

test("trust for one mode keeps every other mode's entry", async () => {
  await withGoToolchain({}, async (project) => {
    const other = manifestText(goResources).replace('"name": "go-toolchain"', '"name": "rust-toolchain"');
    await project.write("components/modes/rust-toolchain/mode.yaml", other);
    await project.write("components/modes/rust-toolchain/scripts/vet.ts", "export {};\n");
    await project.write("components/modes/rust-toolchain/schemas/empty.json", emptySchema);
    const rust = ["approve", "--trust", "rust-toolchain", "--project", project.root];
    assert.equal((await bay(rust, atTerminal("yes"))).exitCode, 0);
    assert.deepEqual(await listTrustState(project, "go-toolchain"), "never trusted");
    assert.equal((await bay(trustArgv(project), atTerminal("yes"))).exitCode, 0);
    assert.deepEqual(
      [await listTrustState(project), await listTrustState(project, "rust-toolchain")],
      ["trusted", "trusted"],
    );
    assert.equal((await bay([...rust, "--reject"], atTerminal("yes"))).exitCode, 0);
    assert.deepEqual(
      [await listTrustState(project), await listTrustState(project, "rust-toolchain")],
      ["trusted", "never trusted"],
    );
  });
});

test("every other case has its sentence, exits 1 and changes nothing", async () => {
  await withGoToolchain({}, async (project) => {
    const named = async (mode: string): Promise<readonly [number, string]> => {
      const ran = await bay(["approve", "--trust", mode, "--project", project.root], atTerminal("yes"));
      return [ran.exitCode, ran.output];
    };
    assert.deepEqual(await named("no-such"), [
      1,
      "There is no mode no-such in this project or the kit, so nothing changed.",
    ]);
    assert.deepEqual(await named("writer"), [
      1,
      "The mode writer lists no command and no throwaway folder, so it needs no trust. Nothing changed.",
    ]);
    assert.deepEqual(await named("git-worktrees"), [
      1,
      "The mode git-worktrees is not active in this project, so nothing changed.",
    ]);
    await project.write(
      "agentbay.config.yaml",
      `${await project.read("agentbay.config.yaml")}modes:\n  - git-worktrees\n`,
    );
    assert.deepEqual(await named("git-worktrees"), [
      1,
      "The mode git-worktrees is in the kit's components/base/, so its list is granted with no trust. Nothing changed.",
    ]);
    assert.equal(await recordText(project), undefined);
    await project.write(".agentbay/trust.json", "{ version: 1");
    assert.deepEqual(await named("go-toolchain"), [
      1,
      ".agentbay/trust.json: The trust record .agentbay/trust.json is not JSON, so no list it holds is granted.\n" +
        "  fix: Remove the file; then each mode outside the kit's components/base/ waits until the owner trusts it " +
        "again.",
    ]);
    assert.equal(await recordText(project), "{ version: 1");
  });
});

test("the trust form takes no run or step, a hash only from chat, and chat needs the full hash", async () => {
  await withGoToolchain({ approvalsFrom: ["chat"] }, async (project) => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [["run-1"], "bay approve --trust <mode> takes no other argument, but 1 were given."],
      [
        ["--hash", goHash],
        "--hash goes with --via chat; at a terminal the kernel records the hash of the card it shows.",
      ],
      [["--via", "chat", "--quote", "yes, trust go-toolchain"], "--via chat needs --hash <the full hash of the card>."],
      [["--via", "chat", "--hash", goHash], '--via chat needs --quote "<the owner\'s exact words>".'],
    ];
    for (const [more, message] of cases) {
      const ran = await bay([...trustArgv(project, ...more), "--json"]);
      assert.deepEqual([ran.exitCode, ran.json], [2, { ok: false, usage: message }]);
    }
    assert.equal(await recordText(project), undefined);
  });
});

test("a command of 200 characters is on the card whole, word by word, and no line passes 44 columns", async () => {
  const flags = Array.from({ length: 12 }, (_, index) => `--flag-number-${String(index).padStart(2, "0")}`);
  const run = ["test", ...flags, "./..."].join(" ");
  const resources = { commandsStartWith: "go", commands: { everything: { run, effects: ["read", "write"] } } };
  await withGoToolchain({ resources }, async (project) => {
    const card = (await bay(trustArgv(project))).output.split("\n\nNothing changed.")[0] ?? "";
    const lines = card.split("\n");
    assert.ok(`go ${run}`.length >= 200);
    assert.deepEqual(
      lines.filter((line) => Array.from(line).length > 44),
      [],
    );
    const shownWords = card.split(/\s+/);
    const positions = ["go", ...run.split(" ")].map((word) => shownWords.indexOf(word));
    assert.ok(
      positions.every((position) => position >= 0),
      card,
    );
    assert.deepEqual(
      positions,
      [...positions].sort((first, second) => first - second),
    );
  });
});

test("characters that could redraw a terminal are shown as escapes on the card", async () => {
  const resources = {
    commands: { vet: { run: "go \u001b[2J \u202eevil", effects: ["read"] } },
    files: { throwaway: [".forge/\u0007bell"] },
  };
  await withGoToolchain({ resources }, async (project) => {
    const card = (await bay(trustArgv(project))).output;
    assert.match(card, /\n {2}vet {2}go \\u001b\[2J \\u202eevil\n/);
    assert.match(card, /\n {2}\.forge\/\\u0007bell\n/);
    const redrawing = Array.from(card).filter((character) => {
      const code = character.charCodeAt(0);
      return (code < 0x20 && character !== "\n") || (code >= 0x7f && code <= 0x9f) || code === 0x202e;
    });
    assert.deepEqual(redrawing, []);
  });
});

test("a word, a command name or a throwaway folder longer than the card is broken across lines and never cut", async () => {
  const word = "x".repeat(70);
  const name = `n${"a".repeat(30)}`;
  const throwaway = `.forge/${"f".repeat(60)}`;
  const resources = {
    commands: { [name]: { run: `go ${word}`, effects: ["read"] } },
    files: { throwaway: [throwaway] },
  };
  await withGoToolchain({ resources }, async (project) => {
    const card = (await bay(trustArgv(project))).output.split("\n\nNothing changed.")[0] ?? "";
    assert.deepEqual(
      card.split("\n").filter((line) => Array.from(line).length > 44),
      [],
    );
    const joined = card
      .split("\n")
      .map((line) => line.trim())
      .join("");
    for (const whole of [word, name, throwaway]) {
      assert.ok(joined.includes(whole), `${whole} is not whole in\n${card}`);
    }
  });
});

test("a mode that lists one command and no throwaway folder is told in the singular, with no folder section", async () => {
  const resources = { commands: { vet: { run: "go vet ./...", effects: ["read"] } } };
  await withGoToolchain({ resources }, async (project) => {
    const ran = await bay(trustArgv(project));
    assert.equal(
      ran.output.split("\n\nNothing changed.")[0],
      [
        "Trust the mode go-toolchain?",
        "  components/modes/go-toolchain",
        "",
        "It lists 1 command. It runs unconfined.",
        "  vet  go vet ./...",
        "       read",
        "",
        "The effects are the mode's own claim.",
        "Its scripts choose the arguments.",
        "You trust exactly this list. Any change",
        "to it asks you again.",
        "",
        "hash 424859d5b5a3",
      ].join("\n"),
    );
    const withdraw = await bay(trustArgv(project, "--reject"), atTerminal("yes"));
    assert.equal(withdraw.output, "The mode go-toolchain is not trusted, so there is no trust to withdraw.");
    assert.equal(
      (await bay(trustArgv(project), atTerminal("yes"))).output.split(".")[0],
      "go-toolchain is trusted: 1 command",
    );
    const withdrawCard = await bay(trustArgv(project, "--reject"));
    assert.equal(
      withdrawCard.output.split("\n").slice(0, 4).join("\n"),
      [
        "Withdraw trust from the mode go-toolchain?",
        "Its 1 command stops being granted. A run",
        "that needs it is refused until you trust the",
        "mode again.",
      ].join("\n"),
    );
  });
});

test("the difference card says how chat gave the trust, shows a removed folder, and says when nothing stayed and no script changed", async () => {
  await withGoToolchain({ approvalsFrom: ["chat"] }, async (project) => {
    const quote = "yes, trust go-toolchain";
    const given = await bay(trustArgv(project, "--via", "chat", "--hash", goHash, "--quote", quote), { ports });
    assert.equal(given.exitCode, 0, given.output);
    const resources = { commands: { vet: { run: "go vet -all", effects: ["read"] } } };
    await project.write(`${folder}/mode.yaml`, manifestText(resources));
    const ran = await bay(trustArgv(project));
    assert.equal(
      ran.output.split("\n\nNothing changed.")[0],
      [
        "The mode go-toolchain changed its list.",
        "You trusted it on 2026-11-17, as the owner",
        'via chat, quoted: "yes, trust go-toolchain".',
        "None of it runs until you decide.",
        "",
        "  - build      go build ./...",
        "               read, write",
        "  - run-tests  go test -json",
        "               read, write, network",
        "  ~ vet        go vet -all",
        "          was  go vet ./...",
        "               read",
        "  - folder .forge/go-cache",
        "  = as before: nothing",
        "",
        "None of its script files changed.",
        "",
        "hash 04e0b3abcd40",
      ].join("\n"),
    );
  });
});

const scriptsCardHash = "0e987b02af54fd559cd199ef0e3c691cd5c84517a9a1fe595d6b962c468e0e89";

const scriptsCard = [
  "The script files of the mode go-toolchain",
  "changed. Its list is as you trusted it.",
  "You trusted it on 2026-11-17, as the owner",
  "at the terminal.",
  "",
  "  + scripts/bench.ts",
  "  - scripts/old.ts",
  "  ~ scripts/vet.ts",
  "",
  "Its scripts choose the arguments of its",
  "commands. The listed words still bound what",
  "any script can run.",
  "",
  `hash ${scriptsCardHash.slice(0, 12)}`,
].join("\n");

const oldScriptHash = "e55565fcdf34f5adbc4b7d09c1ade36d89caddaa146c9f22e778a87837e486ce";

const changedScriptHash = "c2afd79205356c37783dffe4ddbbc245f7986509e949d312cbbc3009670c4349";

const scriptsAfter: Readonly<Record<string, string>> = {
  "scripts/bench.ts": scriptHash,
  "scripts/vet.ts": changedScriptHash,
};

async function withChangedScripts(options: ProjectOptions, body: (project: Project) => Promise<void>): Promise<void> {
  await withGoToolchain(options, async (project) => {
    await project.write(`${folder}/scripts/old.ts`, "export const old = true;\n");
    const given = await bay(trustArgv(project), atTerminal("yes"));
    assert.equal(given.exitCode, 0, given.output);
    await project.write(`${folder}/scripts/vet.ts`, "export const changed = true;\n");
    await project.write(`${folder}/scripts/bench.ts`, "export {};\n");
    await rm(join(project.root, folder, "scripts/old.ts"));
    await body(project);
  });
}

const firstRecord = recordWith("owner at the terminal", {
  "scripts/old.ts": oldScriptHash,
  "scripts/vet.ts": scriptHash,
});

test("after a trusted mode's script files changed, bay approve --trust prints a short card of them and, where the shell is not a terminal, changes nothing", async () => {
  await withChangedScripts({}, async (project) => {
    const ran = await bay(trustArgv(project));
    assert.equal(ran.exitCode, 1);
    assert.equal(
      ran.output,
      `${scriptsCard}\n\nNothing changed. Trust is the owner's to give: at a terminal, or, if agentbay.config.yaml ` +
        `lists chat under approvals.from, with --hash ${scriptsCardHash} --via chat --quote "<the owner's exact words>".`,
    );
    assert.equal(await recordText(project), firstRecord);
  });
});

const nextDay: Partial<KernelPorts> = { clock: { now: () => new Date("2026-11-18T09:30:00.000Z") } };

async function manifestFindings(project: Project): Promise<readonly unknown[]> {
  const ran = await bay(["check", "--json", "--project", project.root]);
  assert.ok(isRecord(ran.json) && Array.isArray(ran.json.findings), ran.output);
  const findings: readonly unknown[] = ran.json.findings;
  return findings.filter((finding) => isRecord(finding) && finding.file === `${folder}/mode.yaml`);
}

type ShownCommand = {
  readonly name: string;
  readonly words: string;
  readonly effects: string;
  readonly line: number;
};

function trustedFinding({ name, words, effects, line }: ShownCommand): unknown {
  return {
    severity: "warning",
    file: `${folder}/mode.yaml`,
    path: `/resources/commands/${name}`,
    line,
    message:
      `Mode go-toolchain, trusted on 2026-11-18 by the owner at the terminal, lists the command ${name}, which runs ` +
      `${words} and which the mode says has the effects: ${effects}; a listed command can run code the agent wrote.`,
    fix:
      "Withdraw with bay approve --trust go-toolchain --reject unless the mode cannot work without the command. " +
      "The kernel believes the effects a mode lists and cannot check them.",
  };
}

test("yes at a terminal records the script files as they are now, with the same list and hash, and bay check no longer reports them", async () => {
  await withChangedScripts({}, async (project) => {
    const changes = { terminal: fakeTerminal({ interactive: true, answer: "yes" }), ports: nextDay };
    const ran = await bay(trustArgv(project), changes);
    assert.deepEqual(changes.terminal.asked, [`${scriptsCard}\nType yes to record that you read them: `]);
    assert.deepEqual(
      [ran.exitCode, ran.output],
      [0, "The script files of go-toolchain are recorded as you read them. Its list is trusted as before."],
    );
    assert.equal(
      await recordText(project),
      recordWith("owner at the terminal", scriptsAfter, "2026-11-18T09:30:00.000Z"),
    );
    assert.equal(await listTrustState(project), "trusted");
    assert.deepEqual(await manifestFindings(project), [
      trustedFinding({ name: "vet", words: "go vet ./...", effects: "read", line: 23 }),
      trustedFinding({ name: "build", words: "go build ./...", effects: "read, write", line: 29 }),
      trustedFinding({ name: "run-tests", words: "go test -json", effects: "read, write, network", line: 36 }),
    ]);
    const again = await bay(trustArgv(project), atTerminal("yes"));
    assert.deepEqual(
      [again.exitCode, again.output],
      [
        1,
        "The mode go-toolchain is already trusted for this list. You trusted it on 2026-11-18, as the owner at the " +
          "terminal. Nothing changed.",
      ],
    );
  });
});

test("at a terminal, anything but yes leaves the script files as they were recorded", async () => {
  await withChangedScripts({}, async (project) => {
    for (const answer of ["y", "no", "", "yes, record them"]) {
      const ran = await bay(trustArgv(project), atTerminal(answer));
      assert.deepEqual([ran.exitCode, ran.output], [1, "Not confirmed; nothing changed."], answer);
    }
    assert.equal(await recordText(project), firstRecord);
  });
});

test("from chat, the script files are recorded only under the rules that give trust", async () => {
  await withChangedScripts({}, async (project) => {
    await assertChatOff(project, scriptsCardHash);
    assert.equal(await recordText(project), firstRecord);
  });
  await withChangedScripts({ approvalsFrom: ["terminal", "chat"] }, async (project) => {
    await assertChatRefusals(project, scriptsCardHash);
    assert.equal(await recordText(project), firstRecord);
    const stale = await bay(trustArgv(project, "--via", "chat", "--hash", goHash, "--quote", "yes, go-toolchain"));
    assert.equal(stale.exitCode, 1);
    assert.equal(await recordText(project), firstRecord);
    const quote = "Yes, I read the go-toolchain scripts";
    const ran = await bay(trustArgv(project, "--via", "chat", "--hash", scriptsCardHash, "--quote", quote), {
      ports,
    });
    assert.equal(ran.exitCode, 0, ran.output);
    assert.equal(
      await recordText(project),
      recordWith(`owner via chat, quoted: ${JSON.stringify(quote)}`, scriptsAfter),
    );
  });
});

test("a script file whose name is longer than the card is broken across lines and never cut", async () => {
  const long = `scripts/${"long-name-".repeat(6)}of-a-script.ts`;
  await withGoToolchain({}, async (project) => {
    assert.equal((await bay(trustArgv(project), atTerminal("yes"))).exitCode, 0);
    await project.write(`${folder}/${long}`, "export {};\n");
    const card = (await bay(trustArgv(project))).output.split("\n\nNothing changed.")[0] ?? "";
    assert.deepEqual(
      card.split("\n").filter((line) => Array.from(line).length > 44),
      [],
    );
    const joined = card
      .split("\n")
      .map((line) => line.trim())
      .join("");
    assert.ok(joined.includes(long), card);
  });
});

test("bay check --json carries a waiting mode's finding in the shape every finding has", async () => {
  await withGoToolchain({}, async (project) => {
    assert.deepEqual(await manifestFindings(project), [
      {
        severity: "warning",
        file: `${folder}/mode.yaml`,
        path: "/resources",
        line: 20,
        message:
          "Mode go-toolchain lists 3 commands and 1 throwaway folder, and the owner does not trust the list of mode " +
          "go-toolchain, so none of it is granted.",
        fix: "The owner reads the list and decides: bay approve --trust go-toolchain",
      },
    ]);
  });
});
