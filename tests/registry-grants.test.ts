import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModeGrants } from "../bay/contracts.ts";
import { layoutOf, type Layout } from "../bay/layout.ts";
import { loadSystemReport, type System } from "../bay/manifests/manifests.ts";
import type { Problem } from "../bay/outcome.ts";
import { fakeFileSystem } from "./fakes.ts";
import { briefingMode, layout, paths, rooted, schemaText, validFiles, yamlText } from "./system-fixture.ts";

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
  {
    rule: "a command in a mode outside the kit's components/base",
    files: briefingWith({ commands: ["node --test"] }),
    layout,
    problem: {
      file: briefingFile,
      path: "/resources/commands/0",
      line: 21,
      message:
        "Mode briefing lists the command node --test; a listed command can run code the agent wrote. " +
        "Only a mode under the kit's components/base/ may list commands.",
      fix: "Remove the command from components/modes/briefing/mode.yaml; a skill step's checks belong in script steps.",
    },
  },
];

for (const broken of brokenProjects) {
  test(`loading gives no system for ${broken.rule}, and says where and how to fix it`, async () => {
    const report = await loadSystemReport(fakeFileSystem(broken.files), broken.layout);
    assert.deepEqual(report.outcome, { ok: false, problems: [broken.problem] });
  });
}

test("the base mode forge in the kit's own folder may name a kernel folder", async () => {
  const report = await loadSystemReport(fakeFileSystem(kitWithForge("components/base/forge", ["bay/"])), layout);
  assert.equal(report.outcome.ok, true);
});

function grantsOfEveryMode(system: System): ReadonlyMap<string, ModeGrants> {
  return new Map([...system.modes].map(([name, mode]) => [name, mode.grants]));
}

async function loadedSystem(files: Readonly<Record<string, string>>, within: Layout): Promise<System> {
  const report = await loadSystemReport(fakeFileSystem(files), within);
  assert.ok(report.outcome.ok, report.outcome.ok ? "" : JSON.stringify(report.outcome.problems, null, 2));
  return report.outcome.value;
}

function noResources(name: string, folder: string): ModeGrants {
  return {
    mode: name,
    modeFolder: folder,
    databaseFile: `/kit/.agentbay/data/${name}.db`,
    migrationsFolder: `${folder}/migrations`,
    readPaths: [folder],
    writePaths: [],
    secrets: [],
    hosts: [],
    commands: [],
  };
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
  assert.deepEqual([...system.inactive], []);
});

test("a mode that is not active is named as inactive and is not a mode of the system", async () => {
  const system = await loadedSystem(projectWithJournal(["out/journal"]), kitInside);
  assert.deepEqual(
    grantsOfEveryMode(system),
    new Map([
      [
        "journal",
        {
          mode: "journal",
          modeFolder: "/project/components/modes/journal",
          databaseFile: "/project/.agentbay/data/journal.db",
          migrationsFolder: "/project/components/modes/journal/migrations",
          readPaths: ["/project/components/modes/journal", "/project/out/journal"],
          writePaths: ["/project/out/journal"],
          secrets: [],
          hosts: [],
          commands: [],
        },
      ],
    ]),
  );
  assert.deepEqual([...system.inactive].sort(), ["briefing", "notes", "store"]);
});
