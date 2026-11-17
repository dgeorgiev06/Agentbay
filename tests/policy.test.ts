import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModeGrants } from "../bay/contracts.ts";
import type { Mode } from "../bay/generated/mode.ts";
import { layoutOf, type Home, type Layout } from "../bay/layout.ts";
import { grantsOf, listOf, type GrantProblem } from "../bay/policy.ts";
import { listHashOf } from "../bay/trust.ts";
import { modeNamed } from "./broker-fixture.ts";
import { grantsWith } from "./grants-fixture.ts";

type DeclaredFiles = NonNullable<NonNullable<Mode["resources"]>["files"]>;

const layout = layoutOf({ kit: "/project", project: "/project" });

const briefing: Mode = modeNamed(
  "briefing",
  {
    db: { migrations: "migrations/" },
    files: { read: ["notes/in/", "shared/./glossary.md"], write: ["out/digests/"] },
    secrets: ["MAIL_TOKEN"],
    network: ["api.example.com", "*.cdn.example.com"],
  },
  {
    digest: {
      description: "When a digest is due.",
      input: "a.json",
      output: "b.json",
      effects: ["read"],
      run: [{ script: "scripts/a.ts" }],
    },
    sync: {
      description: "When new items are due.",
      input: "a.json",
      output: "b.json",
      effects: ["read", "write", "network"],
      run: [{ script: "s.ts" }],
    },
  },
);

const store: Mode = modeNamed("store", undefined);

type ModeEntry = { readonly folder: string; readonly manifest: Mode; readonly home?: Home };

type Modes = readonly ModeEntry[];

function rulingFor(modes: Modes, name: string, within: Layout): ReturnType<typeof grantsOf> {
  const own = modes.find((mode) => mode.manifest.name === name);
  assert.ok(own, `no mode ${name} in the test`);
  const otherModes = modes
    .filter((mode) => mode !== own)
    .map((mode) => ({ name: mode.manifest.name, folder: mode.folder, manifest: mode.manifest }));
  return grantsOf({
    manifest: own.manifest,
    home: own.home ?? "kit",
    folder: own.folder,
    layout: within,
    otherModes,
    record: { ok: true, value: { version: 1, modes: {} } },
  });
}

function grantsFor(modes: Modes, name: string, within: Layout = layout): ModeGrants {
  const ruling = rulingFor(modes, name, within);
  if (!ruling.ok) {
    assert.fail(`expected grants, got ${JSON.stringify(ruling.problems)}`);
  }
  return ruling.value;
}

function problemsFor(modes: Modes, name: string, within: Layout = layout): readonly GrantProblem[] {
  const ruling = rulingFor(modes, name, within);
  if (ruling.ok) {
    assert.fail("expected problems, got grants");
  }
  return ruling.problems;
}

const system: Modes = [
  { folder: "/project/components/modes/briefing", manifest: briefing },
  { folder: "/project/components/base/store", manifest: store },
];

function withFiles(files: DeclaredFiles): Modes {
  return [
    { folder: "/project/components/modes/briefing", manifest: { ...briefing, resources: { files } } },
    { folder: "/project/components/base/store", manifest: store },
  ];
}

function pathProblems(files: DeclaredFiles): readonly string[] {
  return problemsFor(withFiles(files), "briefing").map((problem) => `/${problem.at.join("/")} ${problem.message}`);
}

test("a mode's grants hold its folder, database, migrations, paths, secrets, hosts and commands, not effects", () => {
  assert.deepEqual(rulingFor(system, "briefing", layout), {
    ok: true,
    value: grantsWith({
      mode: "briefing",
      modeFolder: "/project/components/modes/briefing",
      databaseFile: "/project/.agentbay/data/briefing.db",
      migrationsFolder: "/project/components/modes/briefing/migrations",
      readPaths: [
        "/project/components/modes/briefing",
        "/project/notes/in",
        "/project/shared/glossary.md",
        "/project/out/digests",
      ],
      writePaths: ["/project/out/digests"],
      secrets: ["MAIL_TOKEN"],
      hosts: ["api.example.com", "*.cdn.example.com"],
    }),
  });
});

test("a mode that declares no resources may read only its own folder", () => {
  const permissions = grantsFor(system, "store");
  assert.deepEqual(permissions.readPaths, ["/project/components/base/store"]);
  assert.deepEqual(permissions.writePaths, []);
  assert.deepEqual(permissions.secrets, []);
  assert.deepEqual(Object.keys(permissions).includes("effects"), false);
});

test("a declared path that leaves the project root is refused", () => {
  const problems = pathProblems({ read: ["../outside", "/etc/passwd", "notes/../../outside"] });
  assert.equal(problems.length, 3);
  for (const problem of problems) {
    assert.match(problem, /leaves the project root/);
  }
});

test("a declared path into a kernel, state or git folder is refused", () => {
  const problems = pathProblems({
    read: [".agentbay/data/store.db", ".git/config", "bay/sdk.ts", "schemas/", "adapters/x", "framework/limits.yaml"],
  });
  assert.equal(problems.length, 6);
  assert.match(problems[0] ?? "", /^\/resources\/files\/read\/0 .*\.agentbay/);
  assert.match(problems[5] ?? "", /^\/resources\/files\/read\/5 .*framework/);
});

test("a declared path into another mode's folder is refused, and the mode's own folder is allowed", () => {
  const problems = pathProblems({ read: ["components/base/store/scripts", "components/modes/briefing/templates"] });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /^\/resources\/files\/read\/0 .*the folder of the mode store/);
});

test("a declared path that contains a protected folder is refused", () => {
  const problems = pathProblems({ write: [".", "components/", "components/base"] });
  assert.equal(problems.length, 3);
  for (const problem of problems) {
    assert.match(problem, /^\/resources\/files\/write\/\d .*contains/);
  }
});

test("a protected folder is refused in any letter case", () => {
  const problems = pathProblems({ write: ["Bay/sdk.ts", ".AgentBay/data", "Components/Base/Store"] });
  assert.equal(problems.length, 3);
});

test("every problem names the field of the manifest to change, all at once", () => {
  const problems = problemsFor(
    [
      {
        folder: "/project/components/modes/briefing",
        manifest: { ...briefing, resources: { secrets: ["mail-token"], network: ["https://x.example", "*"] } },
      },
    ],
    "briefing",
  );
  assert.deepEqual(
    problems.map((problem) => [problem.at, problem.fix]),
    [
      [["resources", "secrets", 0], "Rename it, for example to MAIL_TOKEN."],
      [
        ["resources", "network", 0],
        "Write the host alone, such as api.example.com or *.example.com, with no scheme, port or path.",
      ],
      [
        ["resources", "network", 1],
        "Write the host alone, such as api.example.com or *.example.com, with no scheme, port or path.",
      ],
    ],
  );
});

test("every problem of a mode is given at once, across paths, secrets, hosts and commands", () => {
  const manifest = {
    ...briefing,
    resources: {
      files: { read: ["bay/"], write: [".git/hooks"] },
      secrets: ["x"],
      commands: { build: { run: "make", effects: [] } },
    },
  };
  const problems = problemsFor([{ folder: "/project/components/modes/briefing", manifest }], "briefing");
  assert.deepEqual(
    problems.map((problem) => problem.at),
    [
      ["resources", "files", "read", 0],
      ["resources", "files", "write", 0],
      ["resources", "secrets", 0],
      ["resources", "commands", "build", "effects"],
    ],
  );
});

function forgeSystem(folder: string, files: DeclaredFiles): Modes {
  return [
    { folder, manifest: modeNamed("forge", { files }) },
    { folder: "/project/components/modes/briefing", manifest: briefing },
  ];
}

test("the base mode forge may write the kernel, schemas, adapters, framework and other modes' folders", () => {
  const write = [
    "bay/",
    "schemas/mode.schema.json",
    "adapters",
    "framework/",
    "components/modes/briefing",
    "components/",
  ];
  const permissions = grantsFor(forgeSystem("/project/components/base/forge", { write }), "forge");
  assert.ok(permissions.writePaths.includes("/project/bay"));
  assert.ok(permissions.writePaths.includes("/project/components/modes/briefing"));
  assert.ok(permissions.writePaths.includes("/project/components"));
});

test("forge may still not name the state or git folders", () => {
  const problems = problemsFor(
    forgeSystem("/project/components/base/forge", { write: [".agentbay/data", ".git/hooks", "."] }),
    "forge",
  );
  assert.equal(problems.length, 3);
  for (const problem of problems) {
    assert.match(problem.message, /which no mode may name/);
  }
});

test("a mode named forge outside components/base/forge gets no forge rights", () => {
  const problems = problemsFor(
    forgeSystem("/project/components/modes/forge", { write: ["bay/", "components/modes/briefing"] }),
    "forge",
  );
  assert.equal(problems.length, 2);
  for (const problem of problems) {
    assert.match(problem.message, /which only the base mode forge may name/);
  }
});

test("a mode other than forge may not declare a write path holding its own manifest, scripts or skills", () => {
  const problems = pathProblems({
    write: [
      "components/modes/briefing",
      "components/modes/briefing/",
      "components/modes/briefing/mode.yaml",
      "components/modes/briefing/scripts",
      "components/modes/briefing/scripts/generated",
      "components/modes/briefing/skills/digest",
      "Components/Modes/Briefing/Scripts",
    ],
  });
  assert.equal(problems.length, 7);
  for (const problem of problems) {
    assert.match(problem, /^\/resources\/files\/write\/\d .*only the base mode forge may write a mode's own code/);
  }
});

test("a mode may still write other folders of its own and read its own code", () => {
  const permissions = grantsFor(
    withFiles({ read: ["components/modes/briefing/scripts"], write: ["components/modes/briefing/out"] }),
    "briefing",
  );
  assert.deepEqual(permissions.writePaths, ["/project/components/modes/briefing/out"]);
});

test("forge may write its own code", () => {
  const permissions = grantsFor(
    forgeSystem("/project/components/base/forge", { write: ["components/base/forge/scripts"] }),
    "forge",
  );
  assert.deepEqual(permissions.writePaths, ["/project/components/base/forge/scripts"]);
});

test("a folder that shares a prefix with a mode's folder is neither that mode's folder nor inside it", () => {
  const notes = modeNamed("notes", {
    files: { write: ["components/modes/notes-archive/out", "components/modes/notes2"] },
  });
  const archive = modeNamed("notes-archive", { files: { write: ["components/modes/notes-archive/out"] } });
  const siblings: Modes = [
    { folder: "/project/components/modes/notes", manifest: notes },
    { folder: "/project/components/modes/notes-archive", manifest: archive },
  ];
  const problems = problemsFor(siblings, "notes");
  assert.equal(problems.length, 1);
  assert.match(problems[0]?.message ?? "", /the folder of the mode notes-archive/);
  const own = grantsFor(siblings, "notes-archive");
  assert.deepEqual(own.writePaths, ["/project/components/modes/notes-archive/out"]);
});

test("a folder that shares a prefix with a mode's own code folders is not its code", () => {
  const permissions = grantsFor(
    withFiles({ write: ["components/modes/briefing/scripts2", "components/modes/briefing/skills-notes"] }),
    "briefing",
  );
  assert.equal(permissions.writePaths.length, 2);
});

test("a project folder that shares a prefix with a protected folder is not protected", () => {
  const permissions = grantsFor(
    withFiles({ read: ["bay-backup/notes"], write: ["schemas-old", "frameworks", ".gitlab"] }),
    "briefing",
  );
  assert.deepEqual(permissions.writePaths, ["/project/schemas-old", "/project/frameworks", "/project/.gitlab"]);
  assert.ok(permissions.readPaths.includes("/project/bay-backup/notes"));
});

const separate = layoutOf({ kit: "/kit", project: "/project" });

const journal: Mode = modeNamed("journal", { db: { migrations: "migrations" }, files: { write: ["out/journal"] } });

function separateSystem(files: DeclaredFiles): Modes {
  return [
    { folder: "/project/components/modes/journal", manifest: { ...journal, resources: { files } }, home: "project" },
    { folder: "/kit/components/modes/briefing", manifest: briefing },
    { folder: "/kit/components/base/store", manifest: store },
  ];
}

test("a kit mode keeps its folder and migrations in the kit, and its paths and database in the project", () => {
  const permissions = grantsFor(separateSystem({}), "briefing", separate);
  assert.equal(permissions.modeFolder, "/kit/components/modes/briefing");
  assert.equal(permissions.migrationsFolder, "/kit/components/modes/briefing/migrations");
  assert.equal(permissions.databaseFile, "/project/.agentbay/data/briefing.db");
  assert.deepEqual(permissions.writePaths, ["/project/out/digests"]);
  assert.deepEqual(permissions.readPaths, [
    "/kit/components/modes/briefing",
    "/project/notes/in",
    "/project/shared/glossary.md",
    "/project/out/digests",
  ]);
  const own = grantsFor(separateSystem({ write: ["out/journal"] }), "journal", separate);
  assert.equal(own.modeFolder, "/project/components/modes/journal");
  assert.equal(own.databaseFile, "/project/.agentbay/data/journal.db");
});

test("a project mode may not name the project's kernel-like folders or its state", () => {
  const problems = problemsFor(
    separateSystem({ write: ["bay/", "schemas", ".agentbay/data", ".git"] }),
    "journal",
    separate,
  );
  assert.deepEqual(
    problems.map((problem) => problem.message),
    [
      "The path bay/ points into the kernel folder bay/, which only the base mode forge may name.",
      "The path schemas points into the schemas folder schemas/, which only the base mode forge may name.",
      "The path .agentbay/data points into the kernel's state folder .agentbay/, which no mode may name.",
      "The path .git points into the git folder .git/, which no mode may name.",
    ],
  );
});

test("a project mode may not name a kit that lies inside the project, nor its kernel or mode folders", () => {
  const kitInside = layoutOf({ kit: "/project/vendor/agentbay", project: "/project" });
  const declared = (files: DeclaredFiles): Modes => [
    { folder: "/project/components/modes/journal", manifest: { ...journal, resources: { files } }, home: "project" },
    { folder: "/project/vendor/agentbay/components/modes/briefing", manifest: briefing },
  ];
  const write = [
    "vendor/agentbay/bay",
    "vendor/agentbay/components/modes/briefing/out",
    "vendor/agentbay/README.md",
    "vendor",
  ];
  const problems = problemsFor(declared({ write }), "journal", kitInside);
  assert.deepEqual(
    problems.map((problem) => problem.message),
    [
      "The path vendor/agentbay/bay points into the kernel folder bay/ of the kit, which only the base mode forge may name.",
      "The path vendor/agentbay/components/modes/briefing/out points into the agentbay kit /project/vendor/agentbay, which a mode may name only when the project is the kit itself.",
      "The path vendor/agentbay/README.md points into the agentbay kit /project/vendor/agentbay, which a mode may name only when the project is the kit itself.",
      "The path vendor contains the kernel folder bay/ of the kit, which only the base mode forge may name.",
    ],
  );
  assert.deepEqual(grantsFor(declared({ write: ["vendor/other"] }), "journal", kitInside).writePaths, [
    "/project/vendor/other",
  ]);
});

test("forge gets no forge rights when the project is not the kit", () => {
  const forgeMode = modeNamed("forge", { files: { write: ["bay/", "components/modes/journal"] } });
  const modes: Modes = [
    { folder: "/kit/components/base/forge", manifest: forgeMode },
    { folder: "/project/components/modes/journal", manifest: journal, home: "project" },
  ];
  const problems = problemsFor(modes, "forge", separate);
  assert.equal(problems.length, 2);
  for (const problem of problems) {
    assert.match(problem.message, /which only the base mode forge may name/);
  }
});

function trustedRulingFor(entry: ModeEntry): ReturnType<typeof grantsOf> {
  const list = listOf(entry.manifest);
  const given = { list, hash: listHashOf(list), at: "2026-11-17T14:02:00.000Z", by: "a test" };
  return grantsOf({
    manifest: entry.manifest,
    home: entry.home ?? "kit",
    folder: entry.folder,
    layout,
    otherModes: [],
    record: { ok: true, value: { version: 1, modes: { [list.mode]: given } } },
  });
}

test("a mode outside the kit's components/base/ that lists commands is granted them only when the owner trusts its list", () => {
  const withCommand: Mode = {
    ...briefing,
    resources: { commands: { tests: { run: "node  --test", effects: ["read", "write"] } } },
  };
  const tests = { name: "tests", words: ["node", "--test"], effects: ["read", "write"] };
  const list = { mode: "briefing", commands: [tests], commandsStartWith: [], throwaway: [] };
  const outside: ModeEntry = { folder: "/project/components/modes/briefing", manifest: withCommand };
  const waiting = grantsFor([outside], "briefing");
  assert.deepEqual([waiting.commands, waiting.listTrust], [[], { state: "never trusted", list }]);
  const trusted = trustedRulingFor(outside);
  assert.ok(trusted.ok);
  assert.deepEqual(trusted.value.commands, [tests]);
  const base = grantsFor([{ folder: "/project/components/base/briefing", manifest: withCommand }], "briefing");
  assert.deepEqual([base.commands, base.listTrust], [[tests], { state: "not needed" }]);
  const projectBase: Modes = [{ folder: "/project/components/base/briefing", manifest: withCommand, home: "project" }];
  assert.deepEqual(grantsFor(projectBase, "briefing").commands, []);
});

test("a listed command with no effects is refused with a fix, in any mode", () => {
  const withCommand: Mode = {
    ...briefing,
    resources: { commands: { tests: { run: "node --test", effects: [] } } },
  };
  const base: Modes = [{ folder: "/project/components/base/briefing", manifest: withCommand }];
  assert.deepEqual(problemsFor(base, "briefing"), [
    {
      at: ["resources", "commands", "tests", "effects"],
      message: "The command tests of mode briefing lists no effects, and a command has at least one.",
      fix:
        "List under resources.commands.tests.effects in components/base/briefing/mode.yaml each effect the command " +
        "can have: read, write, network, spend or delete. The kernel believes the list and cannot check it.",
    },
  ]);
});

test("a mode's commands start with the words it gives once, and a mode that gives none is unchanged", () => {
  const sharing: Mode = {
    ...briefing,
    resources: {
      commandsStartWith: "git  -c core.hooksPath=/dev/null",
      commands: {
        changes: { run: "status --porcelain --", effects: ["read"] },
        "make-branch": { run: "branch  --end-of-options", effects: ["read", "write"] },
      },
    },
  };
  const plain: Mode = {
    ...store,
    resources: { commands: { changes: { run: "git status --porcelain --", effects: ["read"] } } },
  };
  const modes: Modes = [
    { folder: "/project/components/base/briefing", manifest: sharing },
    { folder: "/project/components/base/store", manifest: plain },
  ];
  assert.deepEqual(grantsFor(modes, "briefing").commands, [
    {
      name: "changes",
      words: ["git", "-c", "core.hooksPath=/dev/null", "status", "--porcelain", "--"],
      effects: ["read"],
    },
    {
      name: "make-branch",
      words: ["git", "-c", "core.hooksPath=/dev/null", "branch", "--end-of-options"],
      effects: ["read", "write"],
    },
  ]);
  assert.deepEqual(grantsFor(modes, "store").commands, [
    { name: "changes", words: ["git", "status", "--porcelain", "--"], effects: ["read"] },
  ]);
});

test("a mode outside components/base/ that gives the words its commands start with waits for trust in its whole list", () => {
  const sharing: Mode = {
    ...briefing,
    resources: {
      commandsStartWith: "git -c core.hooksPath=/dev/null",
      commands: { changes: { run: "status --porcelain --", effects: ["read"] } },
    },
  };
  const grants = grantsFor([{ folder: "/project/components/modes/briefing", manifest: sharing }], "briefing");
  assert.deepEqual(grants.commands, []);
  assert.deepEqual(grants.listTrust, {
    state: "never trusted",
    list: {
      mode: "briefing",
      commands: [
        {
          name: "changes",
          words: ["git", "-c", "core.hooksPath=/dev/null", "status", "--porcelain", "--"],
          effects: ["read"],
        },
      ],
      commandsStartWith: ["git", "-c", "core.hooksPath=/dev/null"],
      throwaway: [],
    },
  });
});

test("a mode that gives the words its commands start with and lists no command is refused, in any mode", () => {
  const sharing: Mode = { ...briefing, resources: { commandsStartWith: "git -c core.hooksPath=/dev/null" } };
  const base: Modes = [{ folder: "/project/components/base/briefing", manifest: sharing }];
  assert.deepEqual(problemsFor(base, "briefing"), [
    {
      at: ["resources", "commandsStartWith"],
      message:
        "Mode briefing gives git -c core.hooksPath=/dev/null as the words every command it lists starts with, " +
        "and lists no command.",
      fix:
        "List the commands under resources.commands in components/base/briefing/mode.yaml, " +
        "or remove commandsStartWith.",
    },
  ]);
});

test("a mode outside the kit's components/base/ that names throwaway folders is granted them only when the owner trusts its list", () => {
  const withThrowaway = { ...briefing, resources: { files: { throwaway: ["scratch/"] } } };
  const outside: ModeEntry = { folder: "/project/components/modes/briefing", manifest: withThrowaway };
  const waiting = grantsFor([outside], "briefing");
  const list = { mode: "briefing", commands: [], commandsStartWith: [], throwaway: ["scratch"] };
  assert.deepEqual([waiting.throwawayPaths, waiting.listTrust], [[], { state: "never trusted", list }]);
  const trusted = trustedRulingFor(outside);
  assert.ok(trusted.ok);
  assert.deepEqual(trusted.value.throwawayPaths, ["/project/scratch"]);
  const base: Modes = [{ folder: "/project/components/base/briefing", manifest: withThrowaway }];
  assert.deepEqual(grantsFor(base, "briefing").throwawayPaths, ["/project/scratch"]);
  const projectBase: Modes = [
    { folder: "/project/components/base/briefing", manifest: withThrowaway, home: "project" },
  ];
  assert.deepEqual(grantsFor(projectBase, "briefing").throwawayPaths, []);
});

test("a throwaway folder may not be the project root, nor be or sit inside .agentbay/", () => {
  const named = (throwaway: readonly string[]): Modes => [
    { folder: "/project/components/base/briefing", manifest: { ...briefing, resources: { files: { throwaway } } } },
  ];
  assert.deepEqual(
    problemsFor(named([".", ".agentbay", ".agentbay/scratch"]), "briefing").map((problem) => problem.message),
    [
      "The path . contains the kernel's state folder .agentbay/, which no mode may name.",
      "The path .agentbay points into the kernel's state folder .agentbay/, which no mode may name.",
      "The path .agentbay/scratch points into the kernel's state folder .agentbay/, which no mode may name.",
    ],
  );
});

test("a throwaway folder may not hold, or sit inside, a path that any mode may read or write", () => {
  const forger = modeNamed("forger", {
    files: { write: ["work/out"], throwaway: ["work/", "notes/", "out/digests/copies"] },
  });
  const modes: Modes = [
    { folder: "/project/components/base/forger", manifest: forger },
    { folder: "/project/components/modes/briefing", manifest: briefing },
  ];
  const fix = "Name a throwaway folder that neither holds nor sits inside a path any mode may read or write.";
  assert.deepEqual(problemsFor(modes, "forger"), [
    {
      at: ["resources", "files", "throwaway", 0],
      message:
        "The throwaway folder work/ overlaps work/out, which the mode forger may write; " +
        "the kernel removes whole folders in a throwaway folder.",
      fix,
    },
    {
      at: ["resources", "files", "throwaway", 1],
      message:
        "The throwaway folder notes/ overlaps notes/in/, which the mode briefing may read; " +
        "the kernel removes whole folders in a throwaway folder.",
      fix,
    },
    {
      at: ["resources", "files", "throwaway", 2],
      message:
        "The throwaway folder out/digests/copies overlaps out/digests/, which the mode briefing may write; " +
        "the kernel removes whole folders in a throwaway folder.",
      fix,
    },
  ]);
});
