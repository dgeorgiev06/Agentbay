import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nodeKernelPorts } from "../bay/kernel-ports.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeFolders,
  nodeProcesses,
  nodeRemoval,
  nodeThrowawayFolders,
  systemClock,
} from "../bay/node-ports.ts";

const tenMebibytes = 10 * 1024 * 1024;

test("the kernel runs on the node ports for files, folders, processes and the clock", () => {
  const ports = nodeKernelPorts({ PATH: "/usr/bin:/bin" });
  assert.equal(ports.files, nodeFileSystem);
  assert.equal(ports.throwawayFolders, nodeThrowawayFolders);
  assert.equal(ports.folders, nodeFolders);
  assert.equal(ports.removal, nodeRemoval);
  assert.equal(ports.inspector, nodeFileInspector);
  assert.equal(ports.processes, nodeProcesses);
  assert.equal(ports.childProcesses, nodeChildProcesses);
  assert.equal(ports.clock, systemClock);
});

test("the kernel's HTTP port takes a response of 10 MiB and refuses one byte more", async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("z".repeat(request.url === "/over" ? tenMebibytes + 1 : tenMebibytes));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${String(typeof address === "object" && address !== null ? address.port : 0)}`;
  try {
    const { http } = nodeKernelPorts({ PATH: "/usr/bin:/bin" });
    const edge = await http.request({ method: "GET", url: `${base}/edge`, headers: {} });
    assert.equal(edge.body.length, tenMebibytes);
    await assert.rejects(
      http.request({ method: "GET", url: `${base}/over`, headers: {} }),
      new RegExp(`more than ${String(tenMebibytes)} bytes`),
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
});

test("the kernel's file listing runs the git it finds on the PATH the environment gives", async () => {
  const folder = await mkdtemp(join(tmpdir(), "agentbay-kernel-ports-"));
  try {
    const git = join(folder, "git");
    await writeFile(git, "#!/bin/sh\nprintf 'listed-by-the-path.txt\\0'\n", "utf8");
    await chmod(git, 0o755);
    const { listing } = nodeKernelPorts({ PATH: folder });
    assert.deepEqual(await listing.projectFiles(folder), ["listed-by-the-path.txt"]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
