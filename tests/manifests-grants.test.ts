import assert from "node:assert/strict";
import { test } from "node:test";
import type { ListTrust, ModeGrants, ModeList } from "../bay/contracts.ts";
import { layoutOf, type Layout } from "../bay/layout.ts";
import type { System } from "../bay/manifests/manifests.ts";
import type { Problem } from "../bay/outcome.ts";
import { fakeFileSystem } from "./fakes.ts";
import { grantsWith } from "./grants-fixture.ts";
import {
  briefingMode,
  layout,
  paths,
  rooted,
  schemaText,
  storeMode,
  systemReport,
  trustGiving,
  trustRecordFiles,
  validFiles,
  yamlText,
} from "./system-fixture.ts";

type Broken = {
  readonly rule: string;
  readonly files: Readonly<Record<string, string>>;
  readonly layout: Layout;
  readonly problem: Problem;
};

const pathFix = "Name a folder outside the kernel, state and other modes' folders, and outside the mode's own code.";

const briefingFile = "components/modes/briefing/mode.yaml";

function briefingWith(resources: unknown): Readonly<Record<string, string>> {
  return rooted({ ...validFiles(), [paths.briefing]: yamlText({ ...briefingMode, resources }) });
}

function lookingMode(name: string, write: readonly string[]): unknown {
  return {
    name,
    version: "1.0.0",
    description: `The ${name} mode.`,
    resources: { files: { write } },
    actions: {
      look: {
        description: "When a test looks.",
        input: "schemas/in.json",
        output: "schemas/in.json",
        effects: ["read"],
        run: [{ script: "scripts/look.ts" }],
      },
    },
  };
}

function kitWithForge(folder: string, write: readonly string[]): Readonly<Record<string, string>> {
  return rooted({
    ...validFiles(),
    [`${folder}/mode.yaml`]: yamlText(lookingMode("forge", write)),
    [`${folder}/schemas/in.json`]: schemaText("in"),
    [`${folder}/scripts/look.ts`]: "",
  });
}

const kitInside = layoutOf({ kit: "/project/vendor/agentbay", project: "/project" });

function projectWithJournal(write: readonly string[]): Readonly<Record<string, string>> {
  const kitFiles = Object.entries(validFiles())
    .filter(([path]) => path !== paths.config)
    .map(([path, text]) => [`${kitInside.kit}/${path}`, text] as const);
  return {
    ...Object.fromEntries(kitFiles),
    "/project/agentbay.config.yaml": yamlText({ bindings: {}, adapter: "local" }),
    "/project/components/modes/journal/mode.yaml": yamlText(lookingMode("journal", write)),
    "/project/components/modes/journal/schemas/in.json": schemaText("in"),
    "/project/components/modes/journal/scripts/look.ts": "",
  };
}

function pathProblem(file: string, place: { readonly path: string; readonly line: number }, message: string): Problem {
  return { file, path: place.path, line: place.line, message, fix: pathFix };
}

const firstRead = { path: "/resources/files/read/0", line: 22 };

const firstWrite = { path: "/resources/files/write/0", line: 22 };

const ownWrite = { path: "/resources/files/write/0", line: 7 };

const brokenProjects: readonly Broken[] = [
  {
    rule: "a relative path that climbs out of the project",
    files: briefingWith({ files: { read: ["../outside"] } }),
    layout,
    problem: pathProblem(briefingFile, firstRead, "The path ../outside leaves the project root."),
  },
  {
    rule: "an absolute path",
    files: briefingWith({ files: { read: ["/etc/passwd"] } }),
    layout,
    problem: pathProblem(briefingFile, firstRead, "The path /etc/passwd leaves the project root."),
  },
  {
    rule: "a path into the kernel's state folder",
    files: briefingWith({ files: { write: [".agentbay/data"] } }),
    layout,
    problem: pathProblem(
      briefingFile,
      firstWrite,
      "The path .agentbay/data points into the kernel's state folder .agentbay/, which no mode may name.",
    ),
  },
  {
    rule: "a path into the git folder",
    files: briefingWith({ files: { read: [".git/config"] } }),
    layout,
    problem: pathProblem(
      briefingFile,
      firstRead,
      "The path .git/config points into the git folder .git/, which no mode may name.",
    ),
  },
  {
    rule: "a path into a kernel folder of the kit",
    files: briefingWith({ files: { read: ["bay/sdk.ts"] } }),
    layout,
    problem: pathProblem(
      briefingFile,
      firstRead,
      "The path bay/sdk.ts points into the kernel folder bay/, which only the base mode forge may name.",
    ),
  },
  {
    rule: "a path into a kernel folder of a project that is not the kit",
    files: projectWithJournal(["bay/"]),
    layout: kitInside,
    problem: pathProblem(
      "components/modes/journal/mode.yaml",
      ownWrite,
      "The path bay/ points into the kernel folder bay/, which only the base mode forge may name.",
    ),
  },
  {
    rule: "a path into a kit that lies inside the project",
    files: projectWithJournal(["vendor/agentbay/README.md"]),
    layout: kitInside,
    problem: pathProblem(
      "components/modes/journal/mode.yaml",
      ownWrite,
      "The path vendor/agentbay/README.md points into the agentbay kit /project/vendor/agentbay, " +
        "which a mode may name only when the project is the kit itself.",
    ),
  },
  {
    rule: "a path into another mode's folder",
    files: briefingWith({ files: { write: ["components/modes/notes/out"] } }),
    layout,
    problem: pathProblem(
      briefingFile,
      firstWrite,
      "The path components/modes/notes/out points into the folder of the mode notes, " +
        "which only the base mode forge may name.",
    ),
  },
  {
    rule: "a path that contains a protected folder",
    files: briefingWith({ files: { write: ["components/"] } }),
    layout,
    problem: pathProblem(
      briefingFile,
      firstWrite,
      "The path components/ contains the folder of the mode store, which only the base mode forge may name.",
    ),
  },
  {
    rule: "a write path into the mode's own code",
    files: briefingWith({ files: { write: ["components/modes/briefing/scripts"] } }),
    layout,
    problem: pathProblem(
      briefingFile,
      firstWrite,
      "The path components/modes/briefing/scripts points into the mode's own scripts/ folder, " +
        "and only the base mode forge may write a mode's own code.",
    ),
  },
  {
    rule: "a path into the git folder from the base mode forge",
    files: kitWithForge("components/base/forge", [".git/hooks"]),
    layout,
    problem: pathProblem(
      "components/base/forge/mode.yaml",
      ownWrite,
      "The path .git/hooks points into the git folder .git/, which no mode may name.",
    ),
  },
  {
    rule: "a kernel folder from a mode named forge outside components/base/forge",
    files: kitWithForge("components/modes/forge", ["bay/"]),
    layout,
    problem: pathProblem(
      "components/modes/forge/mode.yaml",
      ownWrite,
      "The path bay/ points into the kernel folder bay/, which only the base mode forge may name.",
    ),
  },
  {
    rule: "a secret name that is not upper case",
    files: briefingWith({ secrets: ["mail-token"] }),
    layout,
    problem: {
      file: briefingFile,
      path: "/resources/secrets/0",
      line: 21,
      message: "The secret name mail-token is not made of upper-case letters, digits and underscores.",
      fix: "Rename it, for example to MAIL_TOKEN.",
    },
  },
  {
    rule: "a host that is not a host name",
    files: briefingWith({ network: ["https://x.example"] }),
    layout,
    problem: {
      file: briefingFile,
      path: "/resources/network/0",
      line: 21,
      message: "The host https://x.example is not a lower-case host name, or a host name after a leading *.",
      fix: "Write the host alone, such as api.example.com or *.example.com, with no scheme, port or path.",
    },
  },
];

for (const broken of brokenProjects) {
  test(`loading gives no system for ${broken.rule}, and says where and how to fix it`, async () => {
    const report = await systemReport(fakeFileSystem(broken.files), broken.layout);
    assert.deepEqual(report.outcome, { ok: false, problems: [broken.problem] });
  });
}

test("the base mode forge in the kit's own folder may name a kernel folder", async () => {
  const report = await systemReport(fakeFileSystem(kitWithForge("components/base/forge", ["bay/"])), layout);
  assert.equal(report.outcome.ok, true);
});

function grantsOfEveryMode(system: System): ReadonlyMap<string, ModeGrants> {
  return new Map(Array.from(system.modes).map(([name, mode]) => [name, mode.grants]));
}

async function loadedSystem(files: Readonly<Record<string, string>>, within: Layout): Promise<System> {
  const report = await systemReport(fakeFileSystem(files), within);
  assert.ok(report.outcome.ok, report.outcome.ok ? "" : JSON.stringify(report.outcome.problems, null, 2));
  return report.outcome.value;
}

function noResources(name: string, folder: string): ModeGrants {
  return grantsWith({
    mode: name,
    modeFolder: folder,
    databaseFile: `/kit/.agentbay/data/${name}.db`,
    migrationsFolder: `${folder}/migrations`,
    readPaths: [folder],
  });
}

test("every mode of a loaded system is active and carries its own grants", async () => {
  const system = await loadedSystem(rooted(validFiles()), layout);
  assert.deepEqual(
    grantsOfEveryMode(system),
    new Map([
      ["store", noResources("store", "/kit/components/base/store")],
      ["notes", noResources("notes", "/kit/components/modes/notes")],
      ["briefing", noResources("briefing", "/kit/components/modes/briefing")],
    ]),
  );
  assert.deepEqual(Array.from(system.inactive), []);
});

test("a mode that is not active is named as inactive and is not a mode of the system", async () => {
  const system = await loadedSystem(projectWithJournal(["out/journal"]), kitInside);
  assert.deepEqual(
    grantsOfEveryMode(system),
    new Map([
      [
        "journal",
        grantsWith({
          mode: "journal",
          modeFolder: "/project/components/modes/journal",
          databaseFile: "/project/.agentbay/data/journal.db",
          migrationsFolder: "/project/components/modes/journal/migrations",
          readPaths: ["/project/components/modes/journal", "/project/out/journal"],
          writePaths: ["/project/out/journal"],
        }),
      ],
    ]),
  );
  assert.deepEqual(Array.from(system.inactive).sort(), ["briefing", "notes", "store"]);
});

const briefingList: ModeList = {
  mode: "briefing",
  commands: [{ name: "tests", words: ["node", "--test"], effects: ["read"] }],
  commandsStartWith: [],
  throwaway: ["scratch"],
};

const olderBriefingList: ModeList = {
  ...briefingList,
  commands: [{ name: "tests", words: ["node", "--test", "--watch"], effects: ["read"] }],
};

const listedByBriefing = {
  commands: [{ name: "tests", words: ["node", "--test"], effects: ["read" as const] }],
  throwawayPaths: ["/kit/scratch"],
};

function projectWithLists(more: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return rooted({
    ...validFiles(),
    [paths.briefing]: yamlText({
      ...briefingMode,
      resources: { commands: { tests: { run: "node --test", effects: ["read"] } }, files: { throwaway: ["scratch/"] } },
    }),
    [paths.store]: yamlText({
      ...storeMode,
      resources: { commands: { changes: { run: "git status", effects: ["read"] } } },
    }),
    ...more,
  });
}

function grantsWithBriefing(briefing: Partial<ModeGrants>): ReadonlyMap<string, ModeGrants> {
  const store = noResources("store", "/kit/components/base/store");
  return new Map([
    ["store", { ...store, commands: [{ name: "changes", words: ["git", "status"], effects: ["read"] }] }],
    ["notes", noResources("notes", "/kit/components/modes/notes")],
    ["briefing", { ...noResources("briefing", "/kit/components/modes/briefing"), ...briefing }],
  ]);
}

function listNotInForce(listTrust: ListTrust): ReadonlyMap<string, ModeGrants> {
  return grantsWithBriefing({ listTrust });
}

const neverTrusted = listNotInForce({ state: "never trusted", list: briefingList });

test("a mode outside the kit's components/base/ that the owner trusts for its list as it is now is granted its list", async () => {
  const system = await loadedSystem(projectWithLists(trustRecordFiles(briefingList)), layout);
  const given = {
    list: briefingList,
    hash: "aa1ecae5ee08abf4e2a3a473f8b42ee72583e1c4cda33fd6a1b0003cc0074c3a",
    ...trustGiving,
  };
  assert.deepEqual(
    grantsOfEveryMode(system),
    grantsWithBriefing({ ...listedByBriefing, listTrust: { state: "trusted", given } }),
  );
});

test("with no trust record, a mode outside the kit's components/base/ loads without its list, never trusted, and a base mode is granted its list", async () => {
  const system = await loadedSystem(projectWithLists({}), layout);
  assert.deepEqual(grantsOfEveryMode(system), neverTrusted);
  assert.deepEqual(Array.from(system.inactive), []);
});

test("with a record for an older list, a mode loads without its list, and the reason says the list changed", async () => {
  const system = await loadedSystem(projectWithLists(trustRecordFiles(olderBriefingList)), layout);
  const given = {
    list: olderBriefingList,
    hash: "4bc162ba117358049a2758b606017292d9f896e30464f5f05b68fed7d2031aee",
    ...trustGiving,
  };
  assert.deepEqual(grantsOfEveryMode(system), listNotInForce({ state: "changed", list: briefingList, given }));
});

test("a record for a mode that does not exist changes nothing and is not an error", async () => {
  const ghost = { ...briefingList, mode: "ghost" };
  const system = await loadedSystem(projectWithLists(trustRecordFiles(ghost)), layout);
  assert.deepEqual(grantsOfEveryMode(system), neverTrusted);
});

test("a record that another mode's entry holds does not grant this mode its list", async () => {
  const record = trustRecordFiles({ ...briefingList, mode: "notes" });
  const system = await loadedSystem(projectWithLists(record), layout);
  assert.deepEqual(grantsOfEveryMode(system), neverTrusted);
});

test("a trust record outside the kernel's folder .agentbay/ of the project is not read", async () => {
  const [, text = ""] = Object.entries(trustRecordFiles(briefingList))[0] ?? [];
  const elsewhere = {
    "trust.json": text,
    "scratch/.agentbay/trust.json": text,
    "components/modes/briefing/.agentbay/trust.json": text,
  };
  const system = await loadedSystem(projectWithLists(elsewhere), layout);
  assert.deepEqual(grantsOfEveryMode(system), neverTrusted);
});

test("an unreadable trust record grants no list outside the kit's components/base/, keeps the reason, and stops nothing else", async () => {
  const system = await loadedSystem(projectWithLists({ ".agentbay/trust.json": "{" }), layout);
  const problem = {
    file: ".agentbay/trust.json",
    path: "",
    message: "The trust record .agentbay/trust.json is not JSON, so no list it holds is granted.",
    fix: "Remove the file; then each mode outside the kit's components/base/ waits until the owner trusts it again.",
  };
  assert.deepEqual(
    grantsOfEveryMode(system),
    listNotInForce({ state: "unreadable record", list: briefingList, problems: [problem] }),
  );
});

test("a change to a trusted mode's script does not change its trust", async () => {
  const changedScript = { ...trustRecordFiles(briefingList), "components/modes/briefing/scripts/select.ts": "changed" };
  const system = await loadedSystem(projectWithLists(changedScript), layout);
  assert.equal(system.modes.get("briefing")?.grants.listTrust.state, "trusted");
  assert.deepEqual(system.modes.get("briefing")?.grants.commands, listedByBriefing.commands);
});
