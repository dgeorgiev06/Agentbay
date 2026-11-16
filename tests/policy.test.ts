import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModeGrants } from "../bay/contracts.ts";
import type { Mode } from "../bay/generated/mode.ts";
import { layoutOf, type Home, type Layout } from "../bay/layout.ts";
import { grantsOf, type GrantProblem } from "../bay/policy.ts";
import { modeNamed } from "./broker-fixture.ts";

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
    .map((mode) => ({ name: mode.manifest.name, folder: mode.folder }));
  return grantsOf({ manifest: own.manifest, home: own.home ?? "kit", folder: own.folder, layout: within, otherModes });
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
    value: {
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
      throwawayPaths: [],
      secrets: ["MAIL_TOKEN"],
      hosts: ["api.example.com", "*.cdn.example.com"],
      commands: [],
    },
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
    resources: { files: { read: ["bay/"], write: [".git/hooks"] }, secrets: ["x"], commands: ["make"] },
  };
  const problems = problemsFor([{ folder: "/project/components/modes/briefing", manifest }], "briefing");
  assert.deepEqual(
    problems.map((problem) => problem.at),
    [
      ["resources", "files", "read", 0],
      ["resources", "files", "write", 0],
      ["resources", "secrets", 0],
      ["resources", "commands", 0],
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

test("only a mode under the kit's components/base may list commands", () => {
  const withCommand = { ...briefing, resources: { commands: ["node --test"] } };
  const outside: Modes = [{ folder: "/project/components/modes/briefing", manifest: withCommand }];
  assert.deepEqual(problemsFor(outside, "briefing"), [
    {
      at: ["resources", "commands", 0],
      message:
        "Mode briefing lists the command node --test; a listed command can run code the agent wrote. " +
        "Only a mode under the kit's components/base/ may list commands.",
      fix: "Remove the command from components/modes/briefing/mode.yaml; a skill step's checks belong in script steps.",
    },
  ]);
  const base: Modes = [{ folder: "/project/components/base/briefing", manifest: withCommand }];
  assert.deepEqual(grantsFor(base, "briefing").commands, ["node --test"]);
  const projectBase: Modes = [{ folder: "/project/components/base/briefing", manifest: withCommand, home: "project" }];
  assert.equal(problemsFor(projectBase, "briefing").length, 1);
});
