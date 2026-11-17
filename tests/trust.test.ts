import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModeList, TrustGiven } from "../bay/contracts.ts";
import type { Mode } from "../bay/generated/mode.ts";
import { layoutOf } from "../bay/layout.ts";
import type { Outcome } from "../bay/outcome.ts";
import type { FileSystem } from "../bay/ports.ts";
import { listOf } from "../bay/policy.ts";
import {
  changedScriptFiles,
  listHashOf,
  readTrustRecord,
  recordWithTrust,
  recordWithoutTrust,
  scriptFilesOf,
  type TrustRecord,
} from "../bay/trust.ts";
import { modeNamed } from "./broker-fixture.ts";
import { fakeFileSystem } from "./fakes.ts";

const project = layoutOf({ kit: "/kit", project: "/home/owner/realty" });

function recordRead(text: string | undefined): Promise<Outcome<TrustRecord>> {
  const files = text === undefined ? {} : { "/home/owner/realty/.agentbay/trust.json": text };
  return readTrustRecord(fakeFileSystem(files), project);
}

const goToolchain: ModeList = {
  mode: "go-toolchain",
  commands: [
    { name: "vet", words: ["go", "vet", "./..."], effects: ["read"] },
    { name: "build", words: ["go", "build", "./..."], effects: ["write", "read"] },
  ],
  commandsStartWith: [],
  throwaway: [".forge/go-cache"],
};

const goToolchainHash = "c8b83b7a4958f2eb1ae4a129c7893cc590d67052ce986aa144ba17563df1445c";

const fix = "Remove the file; then each mode outside the kit's components/base/ waits until the owner trusts it again.";

const emptyRecord: TrustRecord = { version: 1, modes: {} };

function changed(change: Partial<ModeList>): string {
  return listHashOf({ ...goToolchain, ...change });
}

test("the hash of a mode's list is the hash of its name, its commands by name with their words and sorted effects, its starting words and its throwaway folders", () => {
  assert.equal(listHashOf(goToolchain), goToolchainHash);
});

test("the hash changes when a command's name, any word, any effect, the starting words, a throwaway folder or the mode changes", () => {
  const vet = { name: "vet", words: ["go", "vet", "./..."], effects: ["read" as const] };
  const build = { name: "build", words: ["go", "build", "./..."], effects: ["write" as const, "read" as const] };
  const hashes = [
    changed({ commands: [{ ...vet, name: "lint" }, build] }),
    changed({ commands: [{ ...vet, words: ["go", "vet", "./cmd/..."] }, build] }),
    changed({ commands: [{ ...vet, effects: ["read", "network"] }, build] }),
    changed({ commands: [vet, { ...build, effects: ["write"] }] }),
    changed({ commandsStartWith: ["go"] }),
    changed({ throwaway: [".forge/go-cache-2"] }),
    changed({ throwaway: [] }),
    changed({ mode: "rust-toolchain" }),
    changed({ commands: [vet] }),
  ];
  assert.equal(new Set([goToolchainHash, ...hashes]).size, hashes.length + 1);
});

test("the hash does not change with the order of commands, of effects or of throwaway folders", () => {
  const [vet, build] = goToolchain.commands;
  assert.ok(vet !== undefined && build !== undefined);
  assert.equal(changed({ commands: [build, vet] }), goToolchainHash);
  assert.equal(changed({ commands: [vet, { ...build, effects: ["read", "write"] }] }), goToolchainHash);
  const twoFolders = changed({ throwaway: ["b", "a"] });
  assert.equal(changed({ throwaway: ["a", "b"] }), twoFolders);
});

test("a mode's list holds its commands with their resolved words, its starting words and its throwaway folders as written, normalized", () => {
  const manifest: Mode = modeNamed("go-toolchain", {
    commandsStartWith: "go  -C .",
    commands: {
      vet: { run: "vet ./...", effects: ["read"] },
      build: { run: "build  ./...", effects: ["read", "write"] },
    },
    files: { throwaway: [".forge/go-cache/", "./scratch"] },
  });
  assert.deepEqual(listOf(manifest), {
    mode: "go-toolchain",
    commands: [
      { name: "vet", words: ["go", "-C", ".", "vet", "./..."], effects: ["read"] },
      { name: "build", words: ["go", "-C", ".", "build", "./..."], effects: ["read", "write"] },
    ],
    commandsStartWith: ["go", "-C", "."],
    throwaway: [".forge/go-cache", "scratch"],
  });
});

test("the order of commands in the manifest does not change the hash of the list", () => {
  const vet = { run: "vet ./...", effects: ["read" as const] };
  const build = { run: "build ./...", effects: ["read" as const, "write" as const] };
  const first = modeNamed("go-toolchain", { commandsStartWith: "go", commands: { vet, build } });
  const second = modeNamed("go-toolchain", { commandsStartWith: "go", commands: { build, vet } });
  assert.equal(listHashOf(listOf(first)), listHashOf(listOf(second)));
});

test("the trust record is read from the file trust.json in the kernel's folder .agentbay/ of the project, and nowhere else", async () => {
  const files = {
    "/home/owner/realty/.agentbay/trust.json": '{ "version": 1, "modes": {} }',
    "/home/owner/realty/trust.json": "not read",
    "/kit/.agentbay/trust.json": "not read",
  };
  assert.deepEqual(await readTrustRecord(fakeFileSystem(files), project), { ok: true, value: emptyRecord });
});

const given: TrustGiven = {
  list: {
    mode: "go-toolchain",
    commands: [{ name: "vet", words: ["go", "vet"], effects: ["read"] }],
    commandsStartWith: [],
    throwaway: [],
  },
  hash: "06e3676b6374dd765d50e0d9fedfcdc08612ecba5927e85753cb13db48b17863",
  scripts: {},
  at: "2026-11-17T14:02:00.000Z",
  by: "a test",
};

const givenText = [
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
  '              "vet"',
  "            ],",
  '            "effects": [',
  '              "read"',
  "            ]",
  "          }",
  "        ],",
  '        "commandsStartWith": [],',
  '        "throwaway": []',
  "      },",
  `      "hash": "${given.hash}",`,
  '      "scripts": {},',
  '      "at": "2026-11-17T14:02:00.000Z",',
  '      "by": "a test"',
  "    }",
  "  }",
  "}",
  "",
].join("\n");

const giving = { scripts: {}, at: "2026-11-17T14:02:00.000Z", by: "a test" };

test("adding trust to an empty record gives the file text with that one entry: the list whole, its hash, when and how", () => {
  assert.equal(recordWithTrust(emptyRecord, given.list, giving), givenText);
});

test("removing the only entry gives the file text of an empty record, and removing a mode not there changes nothing", () => {
  const record: TrustRecord = { version: 1, modes: { "go-toolchain": given } };
  const emptyText = '{\n  "version": 1,\n  "modes": {}\n}\n';
  assert.equal(recordWithoutTrust(record, "go-toolchain"), emptyText);
  assert.equal(recordWithoutTrust(record, "rust-toolchain"), givenText);
});

test("adding trust replaces the mode's own entry and keeps the others, in the order of their modes' names", async () => {
  const record: TrustRecord = { version: 1, modes: { "go-toolchain": { ...given, by: "an older test" } } };
  assert.equal(recordWithTrust(record, given.list, giving), givenText);
  const read = await recordRead(recordWithTrust(record, { ...given.list, mode: "a-mode" }, giving));
  assert.ok(read.ok, JSON.stringify(read));
  assert.deepEqual(Object.keys(read.value.modes), ["a-mode", "go-toolchain"]);
  assert.equal(read.value.modes["a-mode"]?.hash, "e8019a6715216f9b91f097d6a64e514f625372faf24f846ba0f7e2913a355817");
  assert.equal(read.value.modes["go-toolchain"]?.by, "an older test");
});

test("the file text that adding trust gives is read back as the same record", async () => {
  assert.deepEqual(await recordRead(givenText), { ok: true, value: { version: 1, modes: { "go-toolchain": given } } });
});

test("no trust record is an empty record", async () => {
  assert.deepEqual(await recordRead(undefined), { ok: true, value: { version: 1, modes: {} } });
});

function refusal(path: string, message: string): Outcome<TrustRecord> {
  return { ok: false, problems: [{ file: ".agentbay/trust.json", path, message, fix }] };
}

test("a trust record that is not JSON is refused with its sentence", async () => {
  assert.deepEqual(
    await recordRead("{ version: 1"),
    refusal("", "The trust record .agentbay/trust.json is not JSON, so no list it holds is granted."),
  );
});

test("a trust record that lacks a field is refused with a sentence for each field it lacks", async () => {
  const entry = {
    list: { ...given.list, commands: [{ name: "vet", words: ["go", "vet"] }] },
    at: given.at,
    by: given.by,
  };
  assert.deepEqual(await recordRead(JSON.stringify({ version: 1, modes: { "go-toolchain": entry } })), {
    ok: false,
    problems: [
      {
        file: ".agentbay/trust.json",
        path: "/modes/go-toolchain/list/commands/0/effects",
        message:
          "The trust record .agentbay/trust.json has no field modes.go-toolchain.list.commands.0.effects, " +
          "so no list it holds is granted.",
        fix,
      },
      {
        file: ".agentbay/trust.json",
        path: "/modes/go-toolchain/hash",
        message:
          "The trust record .agentbay/trust.json has no field modes.go-toolchain.hash, so no list it holds is granted.",
        fix,
      },
      {
        file: ".agentbay/trust.json",
        path: "/modes/go-toolchain/scripts",
        message:
          "The trust record .agentbay/trust.json has no field modes.go-toolchain.scripts, " +
          "so no list it holds is granted.",
        fix,
      },
    ],
  });
  assert.deepEqual(await recordRead("{}"), {
    ok: false,
    problems: [
      {
        file: ".agentbay/trust.json",
        path: "/version",
        message: "The trust record .agentbay/trust.json has no field version, so no list it holds is granted.",
        fix,
      },
      {
        file: ".agentbay/trust.json",
        path: "/modes",
        message: "The trust record .agentbay/trust.json has no field modes, so no list it holds is granted.",
        fix,
      },
    ],
  });
});

test("a trust record whose entry lacks its script files, or when or how the trust was given, is refused", async () => {
  const entry = { list: given.list, hash: given.hash };
  const message = (field: string): string =>
    `The trust record .agentbay/trust.json has no field modes.go-toolchain.${field}, so no list it holds is granted.`;
  assert.deepEqual(await recordRead(JSON.stringify({ version: 1, modes: { "go-toolchain": entry } })), {
    ok: false,
    problems: [
      { file: ".agentbay/trust.json", path: "/modes/go-toolchain/scripts", message: message("scripts"), fix },
      { file: ".agentbay/trust.json", path: "/modes/go-toolchain/at", message: message("at"), fix },
      { file: ".agentbay/trust.json", path: "/modes/go-toolchain/by", message: message("by"), fix },
    ],
  });
});

test("a trust record with a field of the wrong kind is refused with its sentence", async () => {
  const record = {
    version: 2,
    modes: {
      "go-toolchain": { ...given, by: 7, scripts: { "scripts/vet.ts": 7 }, list: { ...given.list, throwaway: "x" } },
    },
  };
  assert.deepEqual(await recordRead(JSON.stringify(record)), {
    ok: false,
    problems: [
      {
        file: ".agentbay/trust.json",
        path: "/version",
        message: "The field version of the trust record .agentbay/trust.json is not 1, so no list it holds is granted.",
        fix,
      },
      {
        file: ".agentbay/trust.json",
        path: "/modes/go-toolchain/list/throwaway",
        message:
          "The field modes.go-toolchain.list.throwaway of the trust record .agentbay/trust.json is not a list of texts, " +
          "so no list it holds is granted.",
        fix,
      },
      {
        file: ".agentbay/trust.json",
        path: "/modes/go-toolchain/scripts",
        message:
          "The field modes.go-toolchain.scripts of the trust record .agentbay/trust.json is not a map of script files " +
          "to their hashes, so no list it holds is granted.",
        fix,
      },
      {
        file: ".agentbay/trust.json",
        path: "/modes/go-toolchain/by",
        message:
          "The field modes.go-toolchain.by of the trust record .agentbay/trust.json is not a text, " +
          "so no list it holds is granted.",
        fix,
      },
    ],
  });
});

test("a trust record whose hash is not the hash of its list, or whose entry holds another mode's list, is refused", async () => {
  const record = {
    version: 1,
    modes: {
      "go-toolchain": { ...given, list: { ...given.list, throwaway: ["scratch"] } },
      "rust-toolchain": given,
    },
  };
  assert.deepEqual(await recordRead(JSON.stringify(record)), {
    ok: false,
    problems: [
      {
        file: ".agentbay/trust.json",
        path: "/modes/go-toolchain/hash",
        message:
          "The hash of mode go-toolchain in the trust record .agentbay/trust.json is not the hash of the list beside it, " +
          "so no list it holds is granted.",
        fix,
      },
      {
        file: ".agentbay/trust.json",
        path: "/modes/rust-toolchain/list/mode",
        message:
          "The entry modes.rust-toolchain of the trust record .agentbay/trust.json holds the list of mode go-toolchain, " +
          "so no list it holds is granted.",
        fix,
      },
    ],
  });
});

test("a trust record that is JSON but not an object is refused with its sentence", async () => {
  assert.deepEqual(
    await recordRead("[]"),
    refusal("", "The trust record .agentbay/trust.json is not a JSON object, so no list it holds is granted."),
  );
});

test("a trust record the file system cannot read is refused with its sentence", async () => {
  const unreadable: FileSystem = { ...fakeFileSystem({}), readText: () => Promise.reject(new Error("EACCES")) };
  assert.deepEqual(
    await readTrustRecord(unreadable, project),
    refusal("", "The trust record .agentbay/trust.json cannot be read, so no list it holds is granted."),
  );
});

const folder = "/home/owner/realty/components/modes/go-toolchain";

const modeFiles = {
  [`${folder}/mode.yaml`]: "name: go-toolchain",
  [`${folder}/scripts/vet.ts`]: "export {};",
  [`${folder}/skills/build/SKILL.md`]: "# Build",
  [`${folder}/tests/vet.test.ts`]: "test",
};

const modePaths = ["mode.yaml", "scripts/vet.ts", "skills/build/SKILL.md", "tests/vet.test.ts"];

test("the script files of a mode are every file in its folder outside tests/ but its mode.yaml, each with the hash of its text", async () => {
  assert.deepEqual(await scriptFilesOf(fakeFileSystem(modeFiles), folder, modePaths), {
    "scripts/vet.ts": "8568995a3a393c2f03dd3ae8fcb0631c54835277fdacc0a883d1ca73e8fc19cb",
    "skills/build/SKILL.md": "2e0a468f3399da43854d3ed5dccbd2e4e8eb8dc324ea7706af127eb9503cc109",
  });
});

test("the script files change when a file's text changes, or one is added or removed, and not when mode.yaml, a test or a file outside the mode changes", async () => {
  const before = await scriptFilesOf(fakeFileSystem(modeFiles), folder, modePaths);
  const after = async (files: Record<string, string>, paths: readonly string[]): Promise<readonly string[]> =>
    changedScriptFiles(before, await scriptFilesOf(fakeFileSystem({ ...modeFiles, ...files }), folder, paths));
  assert.deepEqual(await after({ [`${folder}/scripts/vet.ts`]: "export const x = 1;" }, modePaths), ["scripts/vet.ts"]);
  assert.deepEqual(await after({ [`${folder}/scripts/run.ts`]: "export {};" }, [...modePaths, "scripts/run.ts"]), [
    "scripts/run.ts",
  ]);
  assert.deepEqual(await after({}, ["mode.yaml", "scripts/vet.ts"]), ["skills/build/SKILL.md"]);
  const unchanged = {
    [`${folder}/mode.yaml`]: "name: go-toolchain\nversion: 2.0.0",
    [`${folder}/tests/vet.test.ts`]: "changed",
    "/home/owner/realty/components/modes/other/scripts/vet.ts": "changed",
  };
  assert.deepEqual(await after(unchanged, modePaths), []);
});

test("the hash of a mode's list does not cover its script files", () => {
  const trusted = recordWithTrust(emptyRecord, goToolchain, { ...giving, scripts: { "scripts/vet.ts": "a" } });
  const other = recordWithTrust(emptyRecord, goToolchain, { ...giving, scripts: { "scripts/vet.ts": "b" } });
  const hashes = [trusted, other].map((text) => /"hash": "([0-9a-f]{64})"/.exec(text)?.[1]);
  assert.deepEqual(hashes, [goToolchainHash, goToolchainHash]);
});
