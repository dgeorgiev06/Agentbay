import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import type { ChildEnd } from "../bay/broker-ports.ts";
import { createNodeHttp, nodeChildProcesses, nodeFileInspector, nodeProcesses } from "../bay/node-ports.ts";
import { withProject } from "./broker-fixture.ts";

test("the file inspector resolves real paths, tells links apart and lists entries by kind", async () => {
  await withProject(async (root) => {
    await mkdir(join(root, "folder"));
    await writeFile(join(root, "folder", "file.txt"), "x");
    await symlink(join(root, "folder"), join(root, "link"));
    assert.equal(await nodeFileInspector.realPath(join(root, "link", "file.txt")), join(root, "folder", "file.txt"));
    assert.equal(await nodeFileInspector.realPath(join(root, "missing")), undefined);
    assert.equal(await nodeFileInspector.isLink(join(root, "link")), true);
    assert.equal(await nodeFileInspector.isLink(join(root, "folder")), false);
    assert.equal(await nodeFileInspector.isLink(join(root, "missing")), false);
    assert.deepEqual(await nodeFileInspector.entries(root), [
      { name: "folder", kind: "directory" },
      { name: "link", kind: "link" },
      { name: "package.json", kind: "file" },
    ]);
    assert.deepEqual(await nodeFileInspector.entries(join(root, "missing")), []);
  });
});

test("processes run with only the given environment and report the exit code", async () => {
  const result = await nodeProcesses.run({
    command: process.execPath,
    arguments: ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env))); process.exit(3)"],
    directory: process.cwd(),
    environment: { ONLY_THIS: "1" },
    timeoutMilliseconds: 10_000,
  });
  assert.deepEqual(result, { exitCode: 3, stdout: '["ONLY_THIS"]', stderr: "" });
});

test("a process past its time limit is killed, and a missing command is not an exception", async () => {
  const slow = await nodeProcesses.run({
    command: process.execPath,
    arguments: ["-e", "setInterval(() => {}, 1000)"],
    directory: process.cwd(),
    environment: {},
    timeoutMilliseconds: 300,
  });
  assert.equal(slow.exitCode, undefined);
  const missing = await nodeProcesses.run({
    command: "agentbay-no-such-command",
    arguments: [],
    directory: process.cwd(),
    environment: {},
    timeoutMilliseconds: 1000,
  });
  assert.equal(missing.exitCode, undefined);
  assert.match(missing.stderr, /ENOENT/);
});

function startNode(
  source: string,
  limits: { readonly timeout: number; readonly output: number },
): {
  readonly lines: string[];
  readonly send: (line: string) => void;
  readonly ended: Promise<ChildEnd>;
} {
  const lines: string[] = [];
  const child = nodeChildProcesses.start(
    {
      command: process.execPath,
      arguments: ["-e", source],
      directory: process.cwd(),
      environment: {},
      timeoutMilliseconds: limits.timeout,
      maximumOutputBytes: limits.output,
    },
    (line) => {
      lines.push(line);
    },
  );
  return { lines, send: child.send, ended: child.ended };
}

test("a child exchanges lines over its standard streams", async () => {
  const child = startNode(
    "process.stdin.on('data', (d) => { process.stdout.write('got ' + d.toString().trim() + '\\nsecond\\n'); process.exit(0); })",
    { timeout: 10_000, output: 1000 },
  );
  child.send("hello");
  assert.deepEqual(await child.ended, { how: "exited", exitCode: 0, errorOutput: "" });
  assert.deepEqual(child.lines, ["got hello", "second"]);
});

test("a child past its time limit or its output cap is killed", async () => {
  const slow = startNode("setInterval(() => {}, 1000)", { timeout: 300, output: 1000 });
  assert.equal((await slow.ended).how, "timed-out");
  const loud = startNode("process.stderr.write('x'.repeat(5000)); setInterval(() => {}, 1000)", {
    timeout: 10_000,
    output: 1000,
  });
  assert.equal((await loud.ended).how, "output-exceeded");
});

test("a child whose command is missing ends as not started", async () => {
  const child = nodeChildProcesses.start(
    {
      command: "agentbay-no-such-command",
      arguments: [],
      directory: process.cwd(),
      environment: {},
      timeoutMilliseconds: 1000,
      maximumOutputBytes: 1000,
    },
    () => undefined,
  );
  assert.equal((await child.ended).how, "not-started");
});

test("the HTTP port does not follow redirects and refuses a response over its cap", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "https://elsewhere.example/" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(request.url === "/big" ? "z".repeat(5000) : "small");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${String(typeof address === "object" && address !== null ? address.port : 0)}`;
  try {
    const http = createNodeHttp({ maximumResponseBytes: 1000, timeoutMilliseconds: 5000 });
    const redirect = await http.request({ method: "GET", url: `${base}/redirect`, headers: {} });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.location, "https://elsewhere.example/");
    const small = await http.request({ method: "GET", url: `${base}/small`, headers: {} });
    assert.equal(small.body, "small");
    await assert.rejects(http.request({ method: "GET", url: `${base}/big`, headers: {} }), /more than 1000 bytes/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  }
});
