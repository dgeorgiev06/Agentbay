import assert from "node:assert/strict";
import { test } from "node:test";
import type { Mode } from "../bay/generated/mode.ts";
import { layoutOf } from "../bay/layout.ts";
import { permissionsFor, policyFor } from "../bay/policy.ts";
import { accepted, modeNamed, problemsOf, systemOf } from "./broker-fixture.ts";

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

const system = systemOf([
  { folder: "/project/components/modes/briefing", manifest: briefing },
  { folder: "/project/components/base/store", manifest: store },
]);

function withFiles(files: DeclaredFiles): ReturnType<typeof systemOf> {
  return systemOf([
    { folder: "/project/components/modes/briefing", manifest: { ...briefing, resources: { files } } },
    { folder: "/project/components/base/store", manifest: store },
  ]);
}

function pathProblems(files: DeclaredFiles): readonly string[] {
  return problemsOf(permissionsFor(withFiles(files), "briefing", layout)).map(
    (problem) => `${problem.path} ${problem.message}`,
  );
}

test("a mode's grants hold its folder, database, migrations, paths, secrets, hosts and commands, not effects", () => {
  const outcome = permissionsFor(system, "briefing", layout);
  assert.deepEqual(outcome, {
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
      secrets: ["MAIL_TOKEN"],
      hosts: ["api.example.com", "*.cdn.example.com"],
      commands: [],
    },
  });
});

test("a mode that declares no resources may read only its own folder", () => {
  const permissions = accepted(permissionsFor(system, "store", layout));
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

test("every problem names the manifest and the field to change, all at once", () => {
  const problems = problemsOf(
    permissionsFor(
      systemOf([
        {
          folder: "/project/components/modes/briefing",
          manifest: { ...briefing, resources: { secrets: ["mail-token"], network: ["https://x.example", "*"] } },
        },
      ]),
      "briefing",
      layout,
    ),
  );
  assert.deepEqual(
    problems.map((problem) => [problem.file, problem.path]),
    [
      ["components/modes/briefing/mode.yaml", "/resources/secrets/0"],
      ["components/modes/briefing/mode.yaml", "/resources/network/0"],
      ["components/modes/briefing/mode.yaml", "/resources/network/1"],
    ],
  );
  for (const problem of problems) {
    assert.ok(problem.fix !== undefined && problem.fix.length > 0);
  }
});

test("an unknown mode is a problem, not an exception", () => {
  const problems = problemsOf(permissionsFor(system, "missing", layout));
  assert.match(problems[0]?.message ?? "", /no mode named missing/);
});

test("the policy of a system gives every mode's permissions, or every problem of every mode", () => {
  const policy = accepted(policyFor(system, layout));
  assert.equal(policy("store").modeFolder, "/project/components/base/store");
  assert.throws(() => policy("missing"), /not active in the system/);
  const broken = problemsOf(policyFor(withFiles({ read: ["bay/"], write: [".git/hooks"] }), layout));
  assert.equal(broken.length, 2);
});

function forgeSystem(folder: string, files: DeclaredFiles): ReturnType<typeof systemOf> {
  return systemOf([
    { folder, manifest: modeNamed("forge", { files }) },
    { folder: "/project/components/modes/briefing", manifest: briefing },
  ]);
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
  const permissions = accepted(
    permissionsFor(forgeSystem("/project/components/base/forge", { write }), "forge", layout),
  );
  assert.ok(permissions.writePaths.includes("/project/bay"));
  assert.ok(permissions.writePaths.includes("/project/components/modes/briefing"));
  assert.ok(permissions.writePaths.includes("/project/components"));
});

test("forge may still not name the state or git folders", () => {
  const problems = problemsOf(
    permissionsFor(
      forgeSystem("/project/components/base/forge", { write: [".agentbay/data", ".git/hooks", "."] }),
      "forge",
      layout,
    ),
  );
  assert.equal(problems.length, 3);
  for (const problem of problems) {
    assert.match(problem.message, /which no mode may name/);
  }
});

test("a mode named forge outside components/base/forge gets no forge rights", () => {
  const problems = problemsOf(
    permissionsFor(
      forgeSystem("/project/components/modes/forge", { write: ["bay/", "components/modes/briefing"] }),
      "forge",
      layout,
    ),
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
  const permissions = accepted(
    permissionsFor(
      withFiles({ read: ["components/modes/briefing/scripts"], write: ["components/modes/briefing/out"] }),
      "briefing",
      layout,
    ),
  );
  assert.deepEqual(permissions.writePaths, ["/project/components/modes/briefing/out"]);
});

test("forge may write its own code", () => {
  const permissions = accepted(
    permissionsFor(
      forgeSystem("/project/components/base/forge", { write: ["components/base/forge/scripts"] }),
      "forge",
      layout,
    ),
  );
  assert.deepEqual(permissions.writePaths, ["/project/components/base/forge/scripts"]);
});

test("a folder that shares a prefix with a mode's folder is neither that mode's folder nor inside it", () => {
  const notes = modeNamed("notes", {
    files: { write: ["components/modes/notes-archive/out", "components/modes/notes2"] },
  });
  const archive = modeNamed("notes-archive", { files: { write: ["components/modes/notes-archive/out"] } });
  const siblings = systemOf([
    { folder: "/project/components/modes/notes", manifest: notes },
    { folder: "/project/components/modes/notes-archive", manifest: archive },
  ]);
  const problems = problemsOf(permissionsFor(siblings, "notes", layout));
  assert.equal(problems.length, 1);
  assert.match(problems[0]?.message ?? "", /the folder of the mode notes-archive/);
  const own = accepted(permissionsFor(siblings, "notes-archive", layout));
  assert.deepEqual(own.writePaths, ["/project/components/modes/notes-archive/out"]);
});

test("a folder that shares a prefix with a mode's own code folders is not its code", () => {
  const permissions = accepted(
    permissionsFor(
      withFiles({ write: ["components/modes/briefing/scripts2", "components/modes/briefing/skills-notes"] }),
      "briefing",
      layout,
    ),
  );
  assert.equal(permissions.writePaths.length, 2);
});

test("a project folder that shares a prefix with a protected folder is not protected", () => {
  const permissions = accepted(
    permissionsFor(
      withFiles({ read: ["bay-backup/notes"], write: ["schemas-old", "frameworks", ".gitlab"] }),
      "briefing",
      layout,
    ),
  );
  assert.deepEqual(permissions.writePaths, ["/project/schemas-old", "/project/frameworks", "/project/.gitlab"]);
  assert.ok(permissions.readPaths.includes("/project/bay-backup/notes"));
});

const separate = layoutOf({ kit: "/kit", project: "/project" });

const journal: Mode = modeNamed("journal", { db: { migrations: "migrations" }, files: { write: ["out/journal"] } });

function separateSystem(files: DeclaredFiles): ReturnType<typeof systemOf> {
  return systemOf([
    { folder: "/project/components/modes/journal", manifest: { ...journal, resources: { files } }, home: "project" },
    { folder: "/kit/components/modes/briefing", manifest: briefing },
    { folder: "/kit/components/base/store", manifest: store },
  ]);
}

test("a kit mode keeps its folder and migrations in the kit, and its paths and database in the project", () => {
  const permissions = accepted(permissionsFor(separateSystem({}), "briefing", separate));
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
  const own = accepted(permissionsFor(separateSystem({ write: ["out/journal"] }), "journal", separate));
  assert.equal(own.modeFolder, "/project/components/modes/journal");
  assert.equal(own.databaseFile, "/project/.agentbay/data/journal.db");
});

test("a project mode may not name the project's kernel-like folders or its state", () => {
  const problems = problemsOf(
    permissionsFor(separateSystem({ write: ["bay/", "schemas", ".agentbay/data", ".git"] }), "journal", separate),
  );
  assert.deepEqual(
    problems.map((problem) => [problem.file, problem.message]),
    [
      [
        "components/modes/journal/mode.yaml",
        "The path bay/ points into the kernel folder bay/, which only the base mode forge may name.",
      ],
      [
        "components/modes/journal/mode.yaml",
        "The path schemas points into the schemas folder schemas/, which only the base mode forge may name.",
      ],
      [
        "components/modes/journal/mode.yaml",
        "The path .agentbay/data points into the kernel's state folder .agentbay/, which no mode may name.",
      ],
      ["components/modes/journal/mode.yaml", "The path .git points into the git folder .git/, which no mode may name."],
    ],
  );
});

test("a project mode may not name a kit that lies inside the project, nor its kernel or mode folders", () => {
  const kitInside = layoutOf({ kit: "/project/vendor/agentbay", project: "/project" });
  const system = systemOf([
    { folder: "/project/components/modes/journal", manifest: journal, home: "project" },
    { folder: "/project/vendor/agentbay/components/modes/briefing", manifest: briefing },
  ]);
  const declared = (files: DeclaredFiles): ReturnType<typeof systemOf> =>
    systemOf(
      [...system.modes.values()].map((mode) => ({
        folder: mode.folder,
        home: mode.home,
        manifest: mode.manifest.name === "journal" ? { ...journal, resources: { files } } : mode.manifest,
      })),
    );
  const write = [
    "vendor/agentbay/bay",
    "vendor/agentbay/components/modes/briefing/out",
    "vendor/agentbay/README.md",
    "vendor",
  ];
  const problems = problemsOf(permissionsFor(declared({ write }), "journal", kitInside));
  assert.deepEqual(
    problems.map((problem) => problem.message),
    [
      "The path vendor/agentbay/bay points into the kernel folder bay/ of the kit, which only the base mode forge may name.",
      "The path vendor/agentbay/components/modes/briefing/out points into the agentbay kit /project/vendor/agentbay, which a mode may name only when the project is the kit itself.",
      "The path vendor/agentbay/README.md points into the agentbay kit /project/vendor/agentbay, which a mode may name only when the project is the kit itself.",
      "The path vendor contains the kernel folder bay/ of the kit, which only the base mode forge may name.",
    ],
  );
  assert.deepEqual(accepted(permissionsFor(declared({ write: ["vendor/other"] }), "journal", kitInside)).writePaths, [
    "/project/vendor/other",
  ]);
});

test("forge gets no forge rights when the project is not the kit", () => {
  const forgeMode = modeNamed("forge", { files: { write: ["bay/", "components/modes/journal"] } });
  const system = systemOf([
    { folder: "/kit/components/base/forge", manifest: forgeMode },
    { folder: "/project/components/modes/journal", manifest: journal, home: "project" },
  ]);
  const problems = problemsOf(permissionsFor(system, "forge", separate));
  assert.equal(problems.length, 2);
  for (const problem of problems) {
    assert.match(problem.message, /which only the base mode forge may name/);
  }
});

test("a mode that is not active gets no permissions, and the policy skips it", () => {
  const system = { ...separateSystem({ write: ["bay/"] }), active: new Set(["briefing", "store"]) };
  const problems = problemsOf(permissionsFor(system, "journal", separate));
  assert.deepEqual(
    problems.map((problem) => [problem.message, problem.fix]),
    [
      [
        "Mode journal is not active in this project, so nothing of it runs here.",
        "Add journal to modes: in agentbay.config.yaml, or bind an interface it implements.",
      ],
    ],
  );
  const policy = accepted(policyFor(system, separate));
  assert.equal(policy("briefing").modeFolder, "/kit/components/modes/briefing");
  assert.throws(() => policy("journal"), /not active in the system/);
});

test("only a mode under the kit's components/base may list commands", () => {
  const withCommand = { ...briefing, resources: { commands: ["node --test"] } };
  const outside = systemOf([{ folder: "/project/components/modes/briefing", manifest: withCommand }]);
  const [problem] = problemsOf(permissionsFor(outside, "briefing", layout));
  assert.ok(problem);
  assert.equal(problem.path, "/resources/commands/0");
  assert.match(problem.message, /Only a mode under the kit's components\/base\/ may list commands\./);
  const base = systemOf([{ folder: "/project/components/base/briefing", manifest: withCommand }]);
  assert.deepEqual(accepted(permissionsFor(base, "briefing", layout)).commands, ["node --test"]);
});
