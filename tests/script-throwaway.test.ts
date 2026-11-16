import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { loadKernel, nodeKernelPorts } from "../bay/kernel.ts";
import { layoutOf } from "../bay/layout.ts";
import { testEnvironment } from "./kernel-fixture.ts";

const proberScript = [
  'import { writeFileSync } from "node:fs";',
  'import { defineScript } from "agentbay/sdk";',
  "",
  "function written(path) {",
  "  try {",
  "    writeFileSync(path, 'by the script');",
  "    return 'written';",
  "  } catch (error) {",
  "    return error.code;",
  "  }",
  "}",
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const made = await context.files.makeFolder('scratch/copy');",
  "  const linked = await context.files.link('scratch/copy/shared', 'shared');",
  "  const byScript = written('scratch/copy/own.txt');",
  "  const throughLink = written('scratch/copy/shared/through.txt');",
  "  const removed = input.remove === true ? await context.files.remove('scratch/copy') : null;",
  "  return { made, linked, byScript, throughLink, removed };",
  "});",
  "",
].join("\n");

type Prober = {
  readonly root: string;
  readonly remove: () => Promise<void>;
};

async function written(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text, "utf8");
}

async function makeProberKit(throwaway: readonly string[]): Promise<Prober> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-throwaway-")));
  const folder = "components/base/throwaway-prober";
  const manifest = {
    name: "throwaway-prober",
    version: "1.0.0",
    description: "Makes, links and removes in its throwaway folder as a test asks.",
    resources: { files: { throwaway: [...throwaway] } },
    actions: {
      go: {
        description: "When a test uses the throwaway folder.",
        input: "schemas/anything.json",
        output: "schemas/anything.json",
        effects: ["read", "write", "network", "spend", "delete"],
        run: [{ script: "scripts/go.ts" }],
      },
    },
  };
  await written(root, "agentbay.config.yaml", stringify({ bindings: {}, adapter: "fake" }));
  await written(root, `${folder}/mode.yaml`, stringify(manifest));
  await written(root, `${folder}/schemas/anything.json`, `${JSON.stringify({ type: "object" })}\n`);
  await written(root, `${folder}/scripts/go.ts`, proberScript);
  await written(root, "shared/kept.txt", "kept");
  return { root, remove: () => rm(root, { recursive: true, force: true }) };
}

async function loaded(root: string) {
  return loadKernel({
    layout: layoutOf({ kit: root, project: root }),
    ports: nodeKernelPorts(testEnvironment),
    environment: testEnvironment,
    platform: "linux",
  });
}

async function proberOutput(root: string, input: Json): Promise<Json> {
  const kernel = await loaded(root);
  assert.ok(kernel.ok, JSON.stringify(kernel));
  try {
    const started = await kernel.value.runs.start({ action: "throwaway-prober.go" }, input);
    assert.ok(started.ok, JSON.stringify(started));
    const state = started.value.state;
    assert.ok(state.status === "done", JSON.stringify(state));
    return state.output;
  } finally {
    kernel.value.close();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

test("a script makes a folder and a link in its throwaway folder, and its own file calls cannot write there", async () => {
  const kit = await makeProberKit(["scratch"]);
  try {
    assert.deepEqual(await proberOutput(kit.root, { remove: false }), {
      made: { ok: true, value: null },
      linked: { ok: true, value: null },
      byScript: "ERR_ACCESS_DENIED",
      throughLink: "ERR_ACCESS_DENIED",
      removed: null,
    });
    assert.equal(await readlink(join(kit.root, "scratch/copy/shared")), join(kit.root, "shared"));
    assert.equal(await exists(join(kit.root, "shared/through.txt")), false);
  } finally {
    await kit.remove();
  }
});

test("a link in a throwaway folder that leaves it does not stop the mode's scripts from starting", async () => {
  const kit = await makeProberKit(["scratch"]);
  try {
    await mkdir(join(kit.root, "scratch/older"), { recursive: true });
    await symlink(join(kit.root, "shared"), join(kit.root, "scratch/older/shared"));
    assert.deepEqual(await proberOutput(kit.root, { remove: true }), {
      made: { ok: true, value: null },
      linked: { ok: true, value: null },
      byScript: "ERR_ACCESS_DENIED",
      throughLink: "ERR_ACCESS_DENIED",
      removed: { ok: true, value: null },
    });
    assert.equal(await exists(join(kit.root, "scratch/copy")), false);
    assert.equal(await exists(join(kit.root, "shared/kept.txt")), true);
  } finally {
    await kit.remove();
  }
});

test("a throwaway folder inside .agentbay/ keeps the kernel from loading", async () => {
  const kit = await makeProberKit([".agentbay/scratch"]);
  try {
    const kernel = await loaded(kit.root);
    assert.ok(!kernel.ok);
    assert.deepEqual(
      kernel.problems.map((problem) => problem.message),
      ["The path .agentbay/scratch points into the kernel's state folder .agentbay/, which no mode may name."],
    );
  } finally {
    await kit.remove();
  }
});
