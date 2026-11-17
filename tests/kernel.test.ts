import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { layoutOf } from "../bay/layout.ts";
import { loadKernel, nodeKernelPorts } from "../bay/kernel.ts";
import { createProjectFileListing, nodeFileInspector } from "../bay/node-ports.ts";
import { openProject, testEnvironment } from "./kernel-fixture.ts";
import { kit, makeProject } from "./project-fixture.ts";
import { activeModeGrants } from "./system-fixture.ts";

test("the kernel loads a project and holds its system, policy, store and engine", async () => {
  const opened = await openProject();
  const { kernel } = opened;
  assert.deepEqual(Array.from(kernel.system.modes.keys()).sort(), ["greeter", "writer"]);
  assert.equal(
    activeModeGrants(kernel.system, "writer").databaseFile,
    join(opened.project.root, ".agentbay/data/writer.db"),
  );
  assert.ok(existsSync(join(opened.project.root, ".agentbay/kernel.db")));
  assert.equal(kernel.limits.toolCallsPerRound, 200);
  const result = await kernel.runs.start({ action: "greeter.fetch" }, { name: "Ada" });
  assert.ok(result.ok && result.value.state.status === "done");
  assert.deepEqual(result.value.state.output, { greeting: "Hello, Ada" });
  await opened.close();
});

test("the kernel returns the registry's problems instead of a kernel", async () => {
  const project = await makeProject();
  await project.write("agentbay.config.yaml", stringify({ bindings: {}, adapter: "fake" }));
  const loaded = await loadKernel({
    layout: layoutOf({ kit, project: project.root }),
    ports: nodeKernelPorts(testEnvironment),
    environment: testEnvironment,
    platform: "linux",
  });
  assert.ok(!loaded.ok);
  assert.ok(loaded.problems.some((problem) => problem.message.includes("bindings names no mode for greeting-source")));
  assert.ok(!existsSync(join(project.root, ".agentbay/kernel.db")));
  await project.remove();
});

test("the kernel returns the policy's problems when a mode declares a kernel path", async () => {
  const project = await makeProject();
  const manifest = await project.read("components/modes/writer/mode.yaml");
  await project.write("components/modes/writer/mode.yaml", manifest.replace("- out/notes/", "- bay/"));
  const loaded = await loadKernel({
    layout: layoutOf({ kit, project: project.root }),
    ports: nodeKernelPorts(testEnvironment),
    environment: testEnvironment,
    platform: "linux",
  });
  assert.ok(!loaded.ok);
  assert.ok(loaded.problems.some((problem) => problem.message.includes("points into the kernel folder bay/")));
  await project.remove();
});

test("a mode's database is made when first used, with its migrations applied before the first statement", async () => {
  const opened = await openProject();
  const { kernel } = opened;
  const grants = activeModeGrants(kernel.system, "writer");
  const permissions = { grants, actionEffects: ["read" as const, "write" as const] };
  const started = await kernel.runs.start({ action: "writer.compose" }, { name: "Ada" });
  assert.ok(started.ok && started.value.state.status === "waiting", JSON.stringify(started));
  assert.ok(!existsSync(grants.databaseFile), "a script that never used context.db made the database");
  const place = { runId: "none", mode: "writer", action: "compose", stepKey: "0" };
  const broker = kernel.brokerFor(place, permissions);
  try {
    assert.deepEqual(await broker.entries["db.query"]({ sql: "select text from notes", parameters: [] }), {
      ok: true,
      value: [{ text: "The first note." }],
    });
    assert.deepEqual(await broker.entries["db.migrate"]({}), { ok: true, value: [] });
  } finally {
    broker.close();
  }
  assert.ok(existsSync(grants.databaseFile));
  await opened.close();
});

test("the git file listing gives tracked and untracked files and leaves ignored ones out", async () => {
  const project = await makeProject();
  await project.write("out/notes/ignored.txt", "ignored");
  await project.write("notes.txt", "untracked");
  const listed = await createProjectFileListing(testEnvironment, nodeFileInspector).projectFiles(project.root);
  assert.ok(listed.includes("notes.txt"));
  assert.ok(listed.includes("components/modes/writer/mode.yaml"));
  assert.ok(!listed.some((path) => path.startsWith("out/")));
  await project.remove();
});

test("outside a git repository the listing walks the project, leaving node_modules, .git and .agentbay out", async () => {
  const project = await makeProject();
  await rm(join(project.root, ".git"), { recursive: true, force: true });
  await project.write("node_modules/x/index.js", "x");
  await project.write(".agentbay/kernel.db", "x");
  await project.write("out/notes/kept.txt", "kept");
  await symlink("/etc", join(project.root, "linked"));
  const listed = await createProjectFileListing(testEnvironment, nodeFileInspector).projectFiles(project.root);
  assert.ok(listed.includes("components/modes/writer/mode.yaml"));
  assert.ok(listed.includes("out/notes/kept.txt"));
  assert.ok(listed.includes("linked"));
  assert.ok(!listed.some((path) => /^(node_modules|\.git|\.agentbay|linked)\//.test(path)), listed.join("\n"));
  assert.deepEqual(listed, [...listed].sort());
  await project.remove();
});

test("bay check on a project that is not a git repository reports findings instead of an internal error", async () => {
  const project = await makeProject({ ownKernel: true });
  await rm(join(project.root, ".git"), { recursive: true, force: true });
  const ran = spawnSync(process.execPath, [project.cli, "check", "--project", project.root], {
    env: testEnvironment,
    encoding: "utf8",
  });
  assert.notEqual(ran.status, 70, ran.stderr);
  assert.match(ran.stdout, /bay check: \d+ errors?, \d+ warnings?\./);
  await project.remove();
});
