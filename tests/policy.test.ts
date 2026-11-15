import assert from "node:assert/strict";
import { test } from "node:test";
import type { Mode } from "../bay/generated/mode.ts";
import { permissionsFor, permissionsForAction, policyFor } from "../bay/policy.ts";
import { accepted, modeNamed, problemsOf, systemOf } from "./broker-fixture.ts";

type DeclaredFiles = NonNullable<NonNullable<Mode["resources"]>["files"]>;

const layout = { root: "/project", configFile: "agentbay.config.yaml" };

const briefing: Mode = modeNamed(
  "briefing",
  {
    db: { migrations: "migrations/" },
    files: { read: ["notes/in/", "shared/./glossary.md"], write: ["out/digests/"] },
    secrets: ["MAIL_TOKEN"],
    network: ["api.example.com", "*.cdn.example.com"],
    commands: ["node --test"],
  },
  {
    digest: { input: "a.json", output: "b.json", effects: ["read"], run: [{ script: "scripts/a.ts" }] },
    sync: { input: "a.json", output: "b.json", effects: ["read", "write", "network"], run: [{ script: "s.ts" }] },
  },
);

const store: Mode = modeNamed("store", undefined);

const system = systemOf([
  { folder: "components/modes/briefing", manifest: briefing },
  { folder: "components/base/store", manifest: store },
]);

function withFiles(files: DeclaredFiles): ReturnType<typeof systemOf> {
  return systemOf([
    { folder: "components/modes/briefing", manifest: { ...briefing, resources: { files } } },
    { folder: "components/base/store", manifest: store },
  ]);
}

function pathProblems(files: DeclaredFiles): readonly string[] {
  return problemsOf(permissionsFor(withFiles(files), "briefing", layout)).map(
    (problem) => `${problem.path} ${problem.message}`,
  );
}

test("a mode's permissions hold its folder, database, paths, secrets, hosts, commands and the union of effects", () => {
  const outcome = permissionsFor(system, "briefing", layout);
  assert.deepEqual(outcome, {
    ok: true,
    value: {
      mode: "briefing",
      modeFolder: "/project/components/modes/briefing",
      databaseFile: "/project/.agentbay/data/briefing.db",
      readPaths: [
        "/project/components/modes/briefing",
        "/project/notes/in",
        "/project/shared/glossary.md",
        "/project/out/digests",
      ],
      writePaths: ["/project/out/digests"],
      secrets: ["MAIL_TOKEN"],
      hosts: ["api.example.com", "*.cdn.example.com"],
      commands: ["node --test"],
      effects: ["read", "write", "network"],
    },
  });
});

test("a mode that declares no resources may read only its own folder", () => {
  const permissions = accepted(permissionsFor(system, "store", layout));
  assert.deepEqual(permissions.readPaths, ["/project/components/base/store"]);
  assert.deepEqual(permissions.writePaths, []);
  assert.deepEqual(permissions.secrets, []);
  assert.deepEqual(permissions.effects, ["read"]);
});

test("the permissions of one action carry only that action's effects", () => {
  const digest = accepted(permissionsForAction(system, { mode: "briefing", action: "digest" }, layout));
  assert.deepEqual(digest.effects, ["read"]);
  const sync = accepted(permissionsForAction(system, { mode: "briefing", action: "sync" }, layout));
  assert.deepEqual(sync.effects, ["read", "write", "network"]);
  const missing = problemsOf(permissionsForAction(system, { mode: "briefing", action: "nothing" }, layout));
  assert.match(missing[0]?.message ?? "", /has no action nothing/);
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
          folder: "components/modes/briefing",
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
  assert.throws(() => policy("missing"), /does not hold/);
  const broken = problemsOf(policyFor(withFiles({ read: ["bay/"], write: [".git/hooks"] }), layout));
  assert.equal(broken.length, 2);
});
