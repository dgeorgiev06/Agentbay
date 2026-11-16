import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { ChildEnd } from "../bay/ports.ts";
import { createNodeHttp, nodeChildProcesses, nodeFileInspector, nodeProcesses } from "../bay/node-ports.ts";
import { withProject } from "./broker-fixture.ts";
import { isRunning } from "./commands-fixture.ts";

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

function fingerprint(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function outputOf(text: string): { readonly text: string; readonly characters: number; readonly hash: string } {
  return { text, characters: text.length, hash: fingerprint(text) };
}

test("processes run with only the given environment and report the exit code", async () => {
  const result = await nodeProcesses.run({
    command: process.execPath,
    arguments: ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env))); process.exit(3)"],
    directory: process.cwd(),
    environment: { ONLY_THIS: "1" },
    timeoutMilliseconds: 10_000,
  });
  assert.deepEqual(result, {
    end: { how: "exited", exitCode: 3 },
    stdout: outputOf('["ONLY_THIS"]'),
    stderr: outputOf(""),
  });
});

test("a process past its time limit is killed, and a missing command is not an exception", async () => {
  const slow = await nodeProcesses.run({
    command: process.execPath,
    arguments: ["-e", "setInterval(() => {}, 1000)"],
    directory: process.cwd(),
    environment: {},
    timeoutMilliseconds: 300,
  });
  assert.deepEqual(slow.end, { how: "timed-out" });
  const missing = await nodeProcesses.run({
    command: "agentbay-no-such-command",
    arguments: [],
    directory: process.cwd(),
    environment: {},
    timeoutMilliseconds: 1000,
  });
  assert.ok(missing.end.how === "not-started", JSON.stringify(missing.end));
  assert.match(missing.end.reason, /ENOENT/);
});

test("a process keeps the end of its output and a hash of all of it", async () => {
  const written = `${"a".repeat(1024 * 1024)}the end`;
  const result = await nodeProcesses.run({
    command: process.execPath,
    arguments: ["-e", `process.stdout.write("a".repeat(${String(1024 * 1024)}) + "the end")`],
    directory: process.cwd(),
    environment: {},
    timeoutMilliseconds: 10_000,
  });
  assert.equal(result.stdout.text, written.slice(-1024 * 1024));
  assert.equal(result.stdout.characters, 1024 * 1024 + 7);
  assert.equal(result.stdout.hash, fingerprint(written));
});

test("a process past its time limit is stopped with every process it started", async () => {
  const source =
    "const sleeper = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });" +
    "console.log(process.pid, sleeper.pid); setInterval(() => {}, 1000);";
  const result = await nodeProcesses.run({
    command: process.execPath,
    arguments: ["-e", source],
    directory: process.cwd(),
    environment: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    timeoutMilliseconds: 1000,
  });
  assert.deepEqual(result.end, { how: "timed-out" });
  const pids = result.stdout.text.trim().split(" ").map(Number);
  assert.equal(pids.length, 2, result.stdout.text);
  await sleep(200);
  assert.deepEqual(
    pids.map((pid) => isRunning(pid)),
    [false, false],
  );
});

test("a process that ends leaves none of the processes it started running", async () => {
  const source =
    "const sleeper = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });" +
    "sleeper.unref(); console.log(sleeper.pid);";
  const result = await nodeProcesses.run({
    command: process.execPath,
    arguments: ["-e", source],
    directory: process.cwd(),
    environment: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    timeoutMilliseconds: 10_000,
  });
  assert.deepEqual(result.end, { how: "exited", exitCode: 0 });
  await sleep(200);
  assert.equal(isRunning(Number(result.stdout.text.trim())), false);
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
    [
      "process.stdin.on('data', (d) => {",
      "  process.stdout.write('got ' + d.toString().trim() + '\\nsecond\\n');",
      "  process.exit(0);",
      "});",
    ].join("\n"),
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
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
});
