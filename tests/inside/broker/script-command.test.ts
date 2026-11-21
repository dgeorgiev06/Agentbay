import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import type { Effect, ScriptRequest } from "../../../bay/contracts.ts";
import { scriptCommand } from "../../../bay/broker/script-runner.ts";
import { kitFolder, permissionsIn, place } from "../../broker-fixture.ts";

const noSpend = { items: 0, usd: 0, tokens: 0, minutes: 0 };

test("the runner starts node with the permission model, the grants and the preload, and nothing else", () => {
  const request: ScriptRequest = {
    place,
    script: "scripts/a.ts",
    input: null,
    permissions: permissionsIn("/project", {
      readPaths: ["/project/components/modes/notes", "/project/in"],
      writePaths: ["/project/out"],
      effects: ["read", "write"],
    }),
    settings: {},
    remaining: {},
    timeLimitMilliseconds: 1000,
    timeLimitSetBy: "kernel",
    call: () => Promise.resolve({ status: "failed", reason: "no", spent: noSpend }),
    random: () => Promise.resolve({ status: "failed", reason: "no" }),
    startedAt: new Date(0),
  };
  const bay = join(kitFolder, "bay");
  const packages = ["yaml", "ajv", "fast-deep-equal", "fast-uri", "json-schema-traverse"].map((name) =>
    realpathSync(join(kitFolder, "node_modules", name)),
  );
  const entries = [
    "yaml/dist/index.js",
    "ajv/dist/2020.js",
    "fast-deep-equal/index.js",
    "fast-uri/index.js",
    "json-schema-traverse/index.js",
  ];
  assert.deepEqual(scriptCommand("/project/components/modes/notes/scripts/a.ts", request), [
    "--permission",
    `--allow-fs-read=${bay}/broker/script-host.ts`,
    `--allow-fs-read=${bay}/broker/script-preload.ts`,
    `--allow-fs-read=${bay}/broker/operations.ts`,
    `--allow-fs-read=${bay}/broker/script-protocol.ts`,
    `--allow-fs-read=${bay}/protocol-json.ts`,
    `--allow-fs-read=${bay}/sdk.ts`,
    `--allow-fs-read=${bay}/yaml-text.ts`,
    `--allow-fs-read=${bay}/value-check.ts`,
    `--allow-fs-read=${bay}/given-schema.ts`,
    `--allow-fs-read=${bay}/json.ts`,
    ...packages.flatMap((folder) => [`--allow-fs-read=${folder}`, `--allow-fs-read=${folder}/*`]),
    "--allow-fs-read=/project/components/modes/notes",
    "--allow-fs-read=/project/components/modes/notes/*",
    "--allow-fs-read=/project/in",
    "--allow-fs-read=/project/in/*",
    "--allow-fs-write=/project/out",
    "--allow-fs-write=/project/out/*",
    "--disable-warning=ExperimentalWarning",
    `--import=file://${bay}/broker/script-preload.ts`,
    `${bay}/broker/script-host.ts`,
    "/project/components/modes/notes/scripts/a.ts",
    ...["yaml", "ajv/dist/2020.js", "fast-deep-equal", "fast-uri", "json-schema-traverse"].map(
      (specifier, index) =>
        `--agentbay-package=${specifier}=${pathToFileURL(realpathSync(join(kitFolder, "node_modules", entries[index] ?? ""))).href}`,
    ),
  ]);
});

test("the runner tells the preload that files may be removed only when the action declares write and delete", () => {
  const commandFor = (effects: readonly Effect[]): readonly string[] =>
    scriptCommand("/project/components/modes/notes/scripts/a.ts", {
      place,
      script: "scripts/a.ts",
      input: null,
      permissions: permissionsIn("/project", { writePaths: ["/project/out"], effects }),
      settings: {},
      remaining: {},
      timeLimitMilliseconds: 1000,
      timeLimitSetBy: "kernel",
      call: () => Promise.resolve({ status: "failed", reason: "no", spent: noSpend }),
      random: () => Promise.resolve({ status: "failed", reason: "no" }),
      startedAt: new Date(0),
    });
  assert.equal(commandFor(["read", "write", "delete"]).at(-1), "--agentbay-may-remove-files");
  assert.ok(!commandFor(["read", "write"]).includes("--agentbay-may-remove-files"));
  assert.ok(!commandFor(["read", "delete"]).includes("--agentbay-may-remove-files"));
});

test("a script is granted direct file writes only when its action declares write", () => {
  const request = (effects: readonly Effect[]) => ({
    place,
    script: "scripts/a.ts",
    input: null,
    permissions: permissionsIn("/project", { writePaths: ["/project/out"], effects }),
    settings: {},
    remaining: {},
    timeLimitMilliseconds: 1000,
    timeLimitSetBy: "kernel" as const,
    call: () => Promise.reject(new Error("no calls")),
    random: () => Promise.reject(new Error("no random values")),
    startedAt: new Date(0),
  });
  const writeGrants = (effects: readonly Effect[]): readonly string[] =>
    scriptCommand("/project/components/modes/notes/scripts/a.ts", request(effects)).filter((argument) =>
      argument.startsWith("--allow-fs-write"),
    );
  assert.deepEqual(writeGrants(["read"]), []);
  assert.deepEqual(writeGrants(["read", "write"]), [
    "--allow-fs-write=/project/out",
    "--allow-fs-write=/project/out/*",
  ]);
});
