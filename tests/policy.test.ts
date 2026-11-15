import assert from "node:assert/strict";
import { test } from "node:test";
import type { Mode } from "../bay/generated/mode.ts";
import { permissionsFor, permissionsForAction, policyFor } from "../bay/policy.ts";
import { modeNamed, systemOf } from "./broker-fixture.ts";

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

function withFiles(files: NonNullable<Mode["resources"]>["files"]): ReturnType<typeof systemOf> {
  return systemOf([
    { folder: "components/modes/briefing", manifest: { ...briefing, resources: { files } } },
    { folder: "components/base/store", manifest: store },
  ]);
}

function problemsOf(files: NonNullable<Mode["resources"]>["files"]): readonly string[] {
  const outcome = permissionsFor(withFiles(files), "briefing", layout);
  assert.equal(outcome.ok, false);
  return outcome.ok ? [] : outcome.problems.map((problem) => `${problem.path} ${problem.message}`);
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
  const outcome = permissionsFor(system, "store", layout);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.ok && outcome.value.readPaths, ["/project/components/base/store"]);
  assert.deepEqual(outcome.ok && outcome.value.writePaths, []);
  assert.deepEqual(outcome.ok && outcome.value.secrets, []);
  assert.deepEqual(outcome.ok && outcome.value.effects, ["read"]);
});

test("the permissions of one action carry only that action's effects", () => {
  const digest = permissionsForAction(system, { mode: "briefing", action: "digest" }, layout);
  assert.deepEqual(digest.ok && digest.value.effects, ["read"]);
  const sync = permissionsForAction(system, { mode: "briefing", action: "sync" }, layout);
  assert.deepEqual(sync.ok && sync.value.effects, ["read", "write", "network"]);
  const missing = permissionsForAction(system, { mode: "briefing", action: "nothing" }, layout);
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? "" : (missing.problems[0]?.message ?? ""), /has no action nothing/);
});

test("a declared path that leaves the project root is refused", () => {
  const problems = problemsOf({ read: ["../outside", "/etc/passwd", "notes/../../outside"] });
  assert.equal(problems.length, 3);
  for (const problem of problems) {
    assert.match(problem, /leaves the project root/);
  }
});

test("a declared path into a kernel, state or git folder is refused", () => {
  const problems = problemsOf({
    read: [".agentbay/data/store.db", ".git/config", "bay/sdk.ts", "schemas/", "adapters/x", "framework/limits.yaml"],
  });
  assert.equal(problems.length, 6);
  assert.match(problems[0] ?? "", /^\/resources\/files\/read\/0 .*\.agentbay/);
  assert.match(problems[5] ?? "", /^\/resources\/files\/read\/5 .*framework/);
});

test("a declared path into another mode's folder is refused, and the mode's own folder is allowed", () => {
  const problems = problemsOf({ read: ["components/base/store/scripts", "components/modes/briefing/templates"] });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /^\/resources\/files\/read\/0 .*the folder of the mode store/);
});

test("a declared path that contains a protected folder is refused", () => {
  const problems = problemsOf({ write: [".", "components/", "components/base"] });
  assert.equal(problems.length, 3);
  for (const problem of problems) {
    assert.match(problem, /^\/resources\/files\/write\/\d .*contains/);
  }
});

test("a protected folder is refused in any letter case", () => {
  const problems = problemsOf({ write: ["Bay/sdk.ts", ".AgentBay/data", "Components/Base/Store"] });
  assert.equal(problems.length, 3);
});

test("every problem names the manifest and the field to change, all at once", () => {
  const outcome = permissionsFor(
    systemOf([
      {
        folder: "components/modes/briefing",
        manifest: { ...briefing, resources: { secrets: ["mail-token"], network: ["https://x.example", "*"] } },
      },
    ]),
    "briefing",
    layout,
  );
  assert.equal(outcome.ok, false);
  const problems = outcome.ok ? [] : outcome.problems;
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
  const outcome = permissionsFor(system, "missing", layout);
  assert.equal(outcome.ok, false);
  assert.match(outcome.ok ? "" : (outcome.problems[0]?.message ?? ""), /no mode named missing/);
});

test("the policy of a system gives every mode's permissions, or every problem of every mode", () => {
  const policy = policyFor(system, layout);
  assert.equal(policy.ok, true);
  assert.equal(policy.ok && policy.value("store").modeFolder, "/project/components/base/store");
  const broken = policyFor(withFiles({ read: ["bay/"], write: [".git/hooks"] }), layout);
  assert.equal(broken.ok, false);
  assert.equal(broken.ok ? 0 : broken.problems.length, 2);
});
