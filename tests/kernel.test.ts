import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { loadKernel, nodeKernelPorts } from "../bay/kernel.ts";
import { createGitFileListing } from "../bay/node-ports.ts";
import { openProject, testEnvironment } from "./kernel-fixture.ts";
import { kit, makeProject } from "./project-fixture.ts";

test("the kernel loads a project and holds its system, policy, store and engine", async () => {
  const opened = await openProject();
  const { kernel } = opened;
  assert.deepEqual([...kernel.system.modes.keys()].sort(), ["greeter", "writer"]);
  assert.equal(kernel.policyOf("writer").databaseFile, join(opened.project.root, ".agentbay/data/writer.db"));
  assert.ok(existsSync(join(opened.project.root, ".agentbay/kernel.db")));
  const result = await kernel.engine.startAction("greeter.fetch", { name: "Ada" });
  assert.ok(result.ok && result.run.state.status === "done");
  assert.deepEqual(result.run.state.output, { greeting: "Hello, Ada" });
  await opened.close();
});

test("the kernel returns the registry's problems instead of a kernel", async () => {
  const project = await makeProject();
  await project.write("agentbay.config.yaml", stringify({ bindings: {}, adapter: "fake" }));
  const loaded = await loadKernel({
    project: project.root,
    kit,
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
    project: project.root,
    kit,
    ports: nodeKernelPorts(testEnvironment),
    environment: testEnvironment,
    platform: "linux",
  });
  assert.ok(!loaded.ok);
  assert.ok(loaded.problems.some((problem) => problem.message.includes("points into the kernel folder bay/")));
  await project.remove();
});

test("a mode's migrations run once per kernel, before its first script or query", async () => {
  const opened = await openProject();
  const { kernel } = opened;
  const permissions = kernel.policyOf("writer");
  const place = { runId: "none", mode: "writer", action: "compose", stepIndex: 0, stepKey: "0" };
  assert.ok(!existsSync(permissions.databaseFile));
  const first = await kernel.prepareDatabase(place, permissions);
  assert.deepEqual(first, { ok: true, value: ["0001-notes.sql"] });
  assert.equal(await kernel.prepareDatabase(place, permissions), await kernel.prepareDatabase(place, permissions));
  assert.ok(existsSync(permissions.databaseFile));
  await opened.close();
});

test("the git file listing gives tracked and untracked files and leaves ignored ones out", async () => {
  const project = await makeProject();
  await project.write("out/notes/ignored.txt", "ignored");
  await project.write("notes.txt", "untracked");
  const listed = await createGitFileListing(testEnvironment).projectFiles(project.root);
  assert.ok(listed.includes("notes.txt"));
  assert.ok(listed.includes("components/modes/writer/mode.yaml"));
  assert.ok(!listed.some((path) => path.startsWith("out/")));
  await project.remove();
});

test("the git file listing fails loudly outside a git repository", async () => {
  await assert.rejects(createGitFileListing(testEnvironment).projectFiles("/"), /git ls-files could not list/);
});
