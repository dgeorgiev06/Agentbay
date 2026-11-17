import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, symlink } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join, relative } from "node:path";
import { test } from "node:test";
import type { ActionCaller, Effect, Json, ScriptRequest, StepOutcome } from "../bay/contracts.ts";
import { fieldOf } from "../bay/json.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeThrowawayFolders,
  systemClock,
} from "../bay/node-ports.ts";
import type { Clock } from "../bay/ports.ts";
import { createScriptRunner, scriptCommand } from "../bay/broker/script-runner.ts";
import { SecretStore } from "../bay/secrets.ts";
import {
  kitFolder,
  noProcesses,
  permissionsIn,
  place,
  type PermissionChanges,
  projectLayout,
  recordingSink,
  scriptedHttp,
  sdkFile,
  withProject,
  writeProjectFile,
} from "./broker-fixture.ts";
import { fakeClock } from "./fakes.ts";

const madeUpToken = "made-up-script-token-31337";

type Run = {
  readonly outcome: StepOutcome;
  readonly events: ReturnType<typeof recordingSink>;
  readonly calls: readonly (readonly [string, Json])[];
};

type RunOptions = {
  readonly input?: Json;
  readonly permissions?: PermissionChanges;
  readonly timeLimit?: number;
  readonly call?: ActionCaller;
  readonly outputBytes?: number;
  readonly script?: string;
  readonly caller?: string;
  readonly skillInput?: Json;
  readonly clock?: Clock;
};

function scriptSource(body: string): string {
  return [
    `import { defineScript, fail } from ${JSON.stringify(sdkFile)};`,
    "void fail;",
    "export const run = defineScript(async (input, context) => {",
    body,
    "});",
    "",
  ].join("\n");
}

async function attempt(root: string, body: string, options: RunOptions = {}): Promise<Run> {
  await writeProjectFile(root, "components/modes/notes/scripts/probe.ts", scriptSource(body));
  return runScript(root, options);
}

async function runScript(root: string, options: RunOptions): Promise<Run> {
  const events = recordingSink();
  const calls: (readonly [string, Json])[] = [];
  const secrets = new SecretStore({
    environment: { AGENTBAY_SECRET_API_TOKEN: madeUpToken },
    processes: noProcesses,
    platform: "linux",
  });
  const runner = createScriptRunner({
    layout: projectLayout(root),
    files: nodeFileSystem,
    throwawayFolders: nodeThrowawayFolders,
    inspector: nodeFileInspector,
    http: scriptedHttp((request) => {
      if (request.url.endsWith("/redirect")) {
        return { status: 302, headers: { location: "https://evil.example/collect" }, body: "" };
      }
      return { status: 200, headers: {}, body: "remote text" };
    }),
    secrets,
    events,
    clock: options.clock ?? systemClock,
    childProcesses: nodeChildProcesses,
    processes: noProcesses,
    commandSearchPath: "/usr/bin:/bin",
    limits: { outputBytes: options.outputBytes ?? 1_000_000 },
  });
  const request: ScriptRequest = {
    place,
    script: options.script ?? "scripts/probe.ts",
    input: options.input ?? null,
    permissions: permissionsIn(root, { secrets: ["API_TOKEN"], hosts: ["api.example.com"], ...options.permissions }),
    settings: { lookback: "3d" },
    remaining: {},
    timeLimitMilliseconds: options.timeLimit ?? 30_000,
    call:
      options.call ??
      ((reference, input) => {
        calls.push([reference, input]);
        return Promise.resolve({ status: "done", output: { called: reference }, spent: noSpend });
      }),
    ...(options.caller === undefined ? {} : { caller: options.caller }),
    ...(options.skillInput === undefined ? {} : { skillInput: options.skillInput }),
  };
  const outcome = await runner.run(request);
  return { outcome, events, calls };
}

const noSpend = { items: 0, usd: 0, tokens: 0, minutes: 0 };

function outputOf(run: Run): Json {
  if (run.outcome.status !== "done") {
    assert.fail(`expected done, got failed: ${run.outcome.reason}`);
  }
  return run.outcome.output;
}

function reasonOf(run: Run): string {
  if (run.outcome.status !== "failed") {
    assert.fail(`expected failed, got ${JSON.stringify(run.outcome)}`);
  }
  return run.outcome.reason;
}

const tryIt = (expression: string): string =>
  [
    "try {",
    `  const value = await (async () => ${expression})();`,
    "  return { escaped: String(value).slice(0, 200) };",
    "} catch (error) {",
    "  return { refused: String(error?.code ?? error?.message ?? error) };",
    "}",
  ].join("\n");

async function withScriptProject(run: (root: string) => Promise<void>): Promise<void> {
  await withProject(async (root) => {
    await writeProjectFile(root, "notes-in/today.md", "today");
    await writeProjectFile(root, "outside/secret.txt", "made-up outside text");
    await mkdir(join(root, "notes-out"), { recursive: true });
    await run(root);
  });
}

async function withListener(run: (port: number, connections: () => number) => Promise<void>): Promise<void> {
  let count = 0;
  const server: Server = createServer((socket) => {
    count += 1;
    socket.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  try {
    await run(port, () => count);
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
}

test("a script that reads, writes, queries, calls, reports spend and returns output", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(
      root,
      [
        "const today = await context.files.read('notes-in/today.md');",
        "const written = await context.files.write('notes-out/summary.md', `summary of ${input.day}`);",
        "await context.db.execute('create table seen (day text)');",
        "await context.db.execute('insert into seen values (?)', [input.day]);",
        "const rows = await context.db.query('select day from seen');",
        "const called = await context.call('items-store.put', { day: input.day });",
        "const spent = await context.spend({ items: 2, usd: 0.25, tokens: 100 });",
        "await context.spend({ items: 1 });",
        "const listed = await context.files.list('notes-in');",
        "const emitted = await context.events.emit('noted', { day: input.day });",
        "return { today, written, rows, called, spent, listed, emitted, settings: context.settings };",
      ].join("\n"),
      { input: { day: "2026-11-14" }, permissions: { effects: ["read", "write", "spend"] } },
    );
    assert.deepEqual(outputOf(run), {
      today: { ok: true, value: "today" },
      written: { ok: true, value: null },
      rows: { ok: true, value: [{ day: "2026-11-14" }] },
      called: { ok: true, value: { called: "items-store.put" } },
      spent: { ok: true, value: null },
      listed: { ok: true, value: ["today.md"] },
      emitted: { ok: true, value: null },
      settings: { lookback: "3d" },
    });
    assert.equal(await readFile(join(root, "notes-out/summary.md"), "utf8"), "summary of 2026-11-14");
    assert.deepEqual(run.calls, [["items-store.put", { day: "2026-11-14" }]]);
    assert.equal(run.outcome.spent.items, 3);
    assert.equal(run.outcome.spent.usd, 0.25);
    assert.equal(run.outcome.spent.tokens, 100);
    assert.ok(run.outcome.spent.minutes > 0 && run.outcome.spent.minutes < 0.5);
    assert.ok(run.events.events.some((event) => event.kind === "noted"));
  });
});

test("a script cannot read a file outside its paths directly", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(
      root,
      [
        "const fs = await import('node:fs');",
        tryIt(`fs.readFileSync(${JSON.stringify(join(root, "outside/secret.txt"))}, 'utf8')`),
      ].join("\n"),
    );
    assert.deepEqual(outputOf(run), { refused: "ERR_ACCESS_DENIED" });
  });
});

test("a script cannot read /etc/passwd, the kit's own files or the mode's database file", async () => {
  await withScriptProject(async (root) => {
    for (const file of ["/etc/passwd", join(kitFolder, "package.json"), join(root, ".agentbay/data/notes.db")]) {
      const run = await attempt(
        root,
        ["const fs = await import('node:fs');", tryIt(`fs.readFileSync(${JSON.stringify(file)}, 'utf8')`)].join("\n"),
      );
      assert.deepEqual(outputOf(run), { refused: "ERR_ACCESS_DENIED" }, file);
    }
  });
});

test("of the kernel's files a script can read only the six the host and its toolbox are made of", async () => {
  await withScriptProject(async (root) => {
    const entries = await readdir(join(kitFolder, "bay"), { recursive: true, withFileTypes: true });
    const kernelFiles = entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(kitFolder, join(entry.parentPath, entry.name)))
      .sort();
    const run = await attempt(
      root,
      [
        "const fs = await import('node:fs');",
        `const files = ${JSON.stringify(kernelFiles)};`,
        "const readable = [];",
        "for (const file of files) {",
        "  try {",
        `    fs.readFileSync(${JSON.stringify(kitFolder)} + '/' + file);`,
        "    readable.push(file);",
        "  } catch {}",
        "}",
        "return readable;",
      ].join("\n"),
    );
    assert.ok(kernelFiles.length > 100, String(kernelFiles.length));
    assert.deepEqual(outputOf(run), [
      "bay/broker/operations.ts",
      "bay/broker/script-host.ts",
      "bay/broker/script-preload.ts",
      "bay/broker/script-protocol.ts",
      "bay/protocol-json.ts",
      "bay/sdk.ts",
    ]);
  });
});

test("a script cannot write outside its write paths directly, even inside a read path", async () => {
  await withScriptProject(async (root) => {
    for (const file of [join(root, "outside/new.txt"), join(root, "notes-in/today.md"), join(root, "x.txt")]) {
      const run = await attempt(
        root,
        ["const fs = await import('node:fs');", tryIt(`fs.writeFileSync(${JSON.stringify(file)}, 'x')`)].join("\n"),
        { permissions: { effects: ["read", "write"] } },
      );
      assert.deepEqual(outputOf(run), { refused: "ERR_ACCESS_DENIED" }, file);
    }
    const allowed = await attempt(
      root,
      [
        "const fs = await import('node:fs');",
        tryIt(`fs.writeFileSync(${JSON.stringify(join(root, "notes-out/direct.txt"))}, 'direct')`),
      ].join("\n"),
      { permissions: { effects: ["read", "write"] } },
    );
    assert.deepEqual(outputOf(allowed), { escaped: "undefined" });
  });
});

test("a write path that does not exist before the run can be made and written by the script itself", async () => {
  await withScriptProject(async (root) => {
    const folder = join(root, "notes-later");
    const run = await attempt(
      root,
      [
        "const fs = await import('node:fs');",
        tryIt(
          [
            `fs.mkdirSync(${JSON.stringify(folder)})`,
            `?? fs.writeFileSync(${JSON.stringify(join(folder, "a.txt"))}, 'made')`,
          ].join(" "),
        ),
      ].join("\n"),
      {
        permissions: {
          writePaths: [folder],
          readPaths: [join(root, "components/modes/notes"), folder],
          effects: ["read", "write"],
        },
      },
    );
    assert.deepEqual(outputOf(run), { escaped: "undefined" });
    assert.equal(await readFile(join(folder, "a.txt"), "utf8"), "made");
  });
});

const deletingExpressions: readonly string[] = [
  "fs.unlinkSync(file)",
  "fs.rmSync(file)",
  "fs.renameSync(file, `${file}.moved`)",
  "await fs.promises.unlink(file)",
  "await fs.promises.rm(file, { force: true })",
  "await fs.promises.rename(file, `${file}.moved`)",
  "await new Promise((resolve, reject) => fs.unlink(file, (error) => (error ? reject(error) : resolve(1))))",
  "(await import('node:fs/promises')).unlink(file)",
  "(await import('fs')).unlinkSync(file)",
  "process.getBuiltinModule('fs').rmSync(file)",
  "fs.rmdirSync(folder)",
];

function deletingScript(root: string, expression: string): string {
  return [
    "const fs = await import('node:fs');",
    `const file = ${JSON.stringify(join(root, "notes-out/keep.txt"))};`,
    `const folder = ${JSON.stringify(join(root, "notes-out/empty"))};`,
    tryIt(expression),
  ].join("\n");
}

test("a script whose action declares write but not delete cannot remove or rename a file with node:fs", async () => {
  await withScriptProject(async (root) => {
    for (const expression of deletingExpressions) {
      await writeProjectFile(root, "notes-out/keep.txt", "kept");
      await mkdir(join(root, "notes-out/empty"), { recursive: true });
      const run = await attempt(root, deletingScript(root, expression), {
        permissions: { effects: ["read", "write"] },
      });
      assert.match(JSON.stringify(outputOf(run)), /"refused":".*needs the delete effect/, expression);
      assert.equal(await readFile(join(root, "notes-out/keep.txt"), "utf8"), "kept", expression);
    }
  });
});

test("a script cannot put back the removal functions that its preload took away", async () => {
  await withScriptProject(async (root) => {
    await writeProjectFile(root, "notes-out/keep.txt", "kept");
    const run = await attempt(
      root,
      [
        "const fs = await import('node:fs');",
        `const file = ${JSON.stringify(join(root, "notes-out/keep.txt"))};`,
        tryIt("Object.defineProperty(fs.default, 'unlinkSync', { value: () => 1 })"),
      ].join("\n"),
      { permissions: { effects: ["read", "write"] } },
    );
    assert.match(JSON.stringify(outputOf(run)), /"refused":".*Cannot redefine property/);
  });
});

test("a script whose action declares write and delete may remove a file in its write paths", async () => {
  await withScriptProject(async (root) => {
    await writeProjectFile(root, "notes-out/keep.txt", "kept");
    const run = await attempt(root, deletingScript(root, "fs.unlinkSync(file)"), {
      permissions: { effects: ["read", "write", "delete"] },
    });
    assert.deepEqual(outputOf(run), { escaped: "undefined" });
    await assert.rejects(readFile(join(root, "notes-out/keep.txt"), "utf8"), /ENOENT/);
  });
});

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
    call: () => Promise.resolve({ status: "failed", reason: "no", spent: noSpend }),
  };
  const bay = join(kitFolder, "bay");
  assert.deepEqual(scriptCommand("/project/components/modes/notes/scripts/a.ts", request), [
    "--permission",
    `--allow-fs-read=${bay}/broker/script-host.ts`,
    `--allow-fs-read=${bay}/broker/script-preload.ts`,
    `--allow-fs-read=${bay}/broker/operations.ts`,
    `--allow-fs-read=${bay}/broker/script-protocol.ts`,
    `--allow-fs-read=${bay}/protocol-json.ts`,
    `--allow-fs-read=${bay}/sdk.ts`,
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
      call: () => Promise.resolve({ status: "failed", reason: "no", spent: noSpend }),
    });
  assert.equal(commandFor(["read", "write", "delete"]).at(-1), "--agentbay-may-remove-files");
  assert.ok(!commandFor(["read", "write"]).includes("--agentbay-may-remove-files"));
  assert.ok(!commandFor(["read", "delete"]).includes("--agentbay-may-remove-files"));
});

test("a run is refused before it starts when a granted folder holds a link that leaves it", async () => {
  await withScriptProject(async (root) => {
    await writeProjectFile(root, "components/modes/notes/scripts/probe.ts", scriptSource("return 'ran';"));
    await symlink(join(root, "outside/secret.txt"), join(root, "notes-in/link.md"));
    const run = await runScript(root, {});
    const reason = reasonOf(run);
    assert.match(reason, /notes-in\/link\.md/);
    assert.match(reason, /outside/);
    assert.ok(run.events.events.some((event) => event.kind === "refused"));
  });
});

test("a run is refused when the mode folder holds a link that leaves it, or a dangling link", async () => {
  await withScriptProject(async (root) => {
    await writeProjectFile(root, "components/modes/notes/scripts/probe.ts", scriptSource("return 'ran';"));
    await symlink(join(root, "outside"), join(root, "components/modes/notes/away"));
    assert.match(reasonOf(await runScript(root, {})), /components\/modes\/notes\/away/);
  });
  await withScriptProject(async (root) => {
    await writeProjectFile(root, "components/modes/notes/scripts/probe.ts", scriptSource("return 'ran';"));
    await symlink(join(root, "nowhere"), join(root, "notes-out/dangling"));
    assert.match(reasonOf(await runScript(root, {})), /notes-out\/dangling/);
  });
});

test("a run is refused when a granted folder is itself a link to another folder of the project", async () => {
  await withProject(async (root) => {
    await writeProjectFile(root, "components/modes/notes/scripts/probe.ts", scriptSource("return 'ran';"));
    await writeProjectFile(root, ".agentbay/data/store.db", "made-up database bytes");
    await mkdir(join(root, "notes-out"));
    await symlink(join(root, ".agentbay/data"), join(root, "notes-in"));
    assert.match(reasonOf(await runScript(root, {})), /notes-in points to .*\.agentbay\/data/);
  });
});

test("a link that stays inside its folder does not stop a run", async () => {
  await withScriptProject(async (root) => {
    await writeProjectFile(root, "components/modes/notes/scripts/probe.ts", scriptSource("return 'ran';"));
    await symlink(join(root, "notes-in/today.md"), join(root, "notes-in/alias.md"));
    assert.equal(outputOf(await runScript(root, {})), "ran");
  });
});

test("a script cannot make a link at run time to read through it", async () => {
  await withScriptProject(async (root) => {
    const link = join(root, "notes-out/escape");
    const run = await attempt(
      root,
      [
        "const fs = await import('node:fs');",
        tryIt(`fs.symlinkSync(${JSON.stringify(join(root, "outside/secret.txt"))}, ${JSON.stringify(link)})`),
      ].join("\n"),
    );
    assert.deepEqual(outputOf(run), { refused: "ERR_ACCESS_DENIED" });
  });
});

test("a script cannot spawn a child process by any import route", async () => {
  await withScriptProject(async (root) => {
    for (const expression of [
      "(await import('node:child_process')).execSync('id')",
      "(await import('child_process')).spawnSync('id')",
      "process.getBuiltinModule('node:child_process').execSync('id')",
    ]) {
      const run = await attempt(root, tryIt(expression));
      assert.match(JSON.stringify(outputOf(run)), /"refused":".*not available to scripts/, expression);
    }
  });
});

test("a script cannot start a worker", async () => {
  await withScriptProject(async (root) => {
    for (const expression of [
      "new (await import('node:worker_threads')).Worker('1', { eval: true })",
      "(await import('node:cluster')).fork()",
    ]) {
      const run = await attempt(root, tryIt(expression));
      assert.match(JSON.stringify(outputOf(run)), /"refused":".*not available to scripts/, expression);
    }
  });
});

test("a script cannot import the network or SQLite modules", async () => {
  await withScriptProject(async (root) => {
    for (const name of [
      "node:net",
      "net",
      "node:tls",
      "node:http",
      "node:https",
      "node:http2",
      "node:dgram",
      "node:dns",
      "node:sqlite",
      "node:inspector",
      "node:vm",
      "_http_client",
      "node:_tls_wrap",
      "node:module",
    ]) {
      const run = await attempt(root, tryIt(`await import(${JSON.stringify(name)})`));
      assert.match(JSON.stringify(outputOf(run)), /"refused":".*not available to scripts/, name);
    }
  });
});

test("a script cannot reach the network through fetch, WebSocket or getBuiltinModule", async () => {
  await withListener(async (port, connections) => {
    await withScriptProject(async (root) => {
      for (const expression of [
        `fetch('http://127.0.0.1:${String(port)}/')`,
        `new WebSocket('ws://127.0.0.1:${String(port)}/')`,
        "new EventSource('http://127.0.0.1/')",
        `process.getBuiltinModule('node:net').connect(${String(port)}, '127.0.0.1')`,
        `process.getBuiltinModule('net').connect(${String(port)}, '127.0.0.1')`,
        `Object.getPrototypeOf(process).getBuiltinModule('node:net')`,
        "process.binding('tcp_wrap')",
      ]) {
        const run = await attempt(root, tryIt(expression));
        assert.match(JSON.stringify(outputOf(run)), /"refused"/, expression);
      }
      assert.equal(connections(), 0);
    });
  });
});

test("a script cannot connect through the socket class behind its own standard streams", async () => {
  await withListener(async (port, connections) => {
    await withScriptProject(async (root) => {
      const run = await attempt(
        root,
        [
          "const Socket = process.stdout.constructor;",
          tryIt(
            [
              "await new Promise((resolve, reject) => {",
              "  const s = new Socket();",
              "  s.on('error', reject);",
              `  s.connect(${String(port)}, '127.0.0.1', () => resolve('connected'));`,
              "})",
            ].join("\n"),
          ),
        ].join("\n"),
      );
      assert.match(JSON.stringify(outputOf(run)), /"refused"/);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(connections(), 0);
    });
  });
});

test("a script cannot bind, listen or connect with the raw handle behind its standard streams", async () => {
  await withScriptProject(async (root) => {
    const socket = join(root, "outside", "made.sock");
    for (const expression of [
      `new (process.stdout._handle.constructor)(0).bind(${JSON.stringify(socket)})`,
      "new (process.stdin._handle.constructor)(0).listen(1)",
      "process.stderr._handle.connect({ oncomplete() {} }, '/tmp/agentbay-no.sock')",
    ]) {
      const run = await attempt(root, tryIt(expression));
      assert.match(JSON.stringify(outputOf(run)), /"refused":".*it opens sockets/, expression);
    }
    await assert.rejects(readFile(socket), /ENOENT/);
  });
});

test("a script finds no secret, token or NODE_OPTIONS in its environment", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(root, "return { keys: Object.keys(process.env), execArgv: process.execArgv };");
    const output = outputOf(run);
    assert.deepEqual(JSON.stringify(output).includes(madeUpToken), false);
    assert.match(JSON.stringify(output), /^\{"keys":\[\],/);
    assert.doesNotMatch(JSON.stringify(output), /NODE_OPTIONS|--require|--allow-child-process|--allow-worker/);
  });
});

test("a parent started with a hostile NODE_OPTIONS and NODE_PATH starts a child that loads neither", async () => {
  await withScriptProject(async (root) => {
    const log = join(root, "evil.log");
    const evil = await writeProjectFile(
      root,
      "evil/evil.cjs",
      `require("node:fs").appendFileSync(${JSON.stringify(log)}, process.pid + " " + process.argv.join(" ") + "\\n");`,
    );
    await writeProjectFile(root, "evil/node_modules/planted/index.js", "module.exports = 'planted';");
    await writeProjectFile(
      root,
      "components/modes/notes/scripts/probe.ts",
      scriptSource(
        [
          "return {",
          "  options: process.env.NODE_OPTIONS ?? null,",
          "  path: process.env.NODE_PATH ?? null,",
          "  execArgv: process.execArgv.join(' '),",
          "  planted: await import('planted').then(",
          "    (loaded) => ({ escaped: loaded.default }),",
          "    (error) => ({ refused: error.code }),",
          "  ),",
          "};",
        ].join("\n"),
      ),
    );
    const driver = join(kitFolder, "tests", "script-runner-driver.ts");
    const child = spawn(process.execPath, [driver, root], {
      env: {
        PATH: process.env.PATH ?? "",
        NODE_OPTIONS: `--require ${evil}`,
        NODE_PATH: join(root, "evil/node_modules"),
        AGENTBAY_SECRET_API_TOKEN: madeUpToken,
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    const exitCode = await new Promise<number | null>((resolve) => child.on("close", resolve));
    assert.equal(exitCode, 0);
    const logged = (await readFile(log, "utf8")).trim().split("\n");
    assert.equal(logged.length, 1, `evil.cjs ran in: ${logged.join(" | ")}`);
    assert.match(logged[0] ?? "", /script-runner-driver\.ts/);
    const outcome: unknown = JSON.parse(stdout);
    assert.match(JSON.stringify(outcome), /"status":"done"/);
    assert.match(JSON.stringify(outcome), /"options":null,"path":null/);
    assert.doesNotMatch(JSON.stringify(outcome), /--require/);
    assert.match(JSON.stringify(outcome), /"planted":\{"refused"/);
  });
});

test("through the broker, a script is refused an undeclared secret and gets a declared one", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(
      root,
      [
        "const other = await context.secrets.get('OTHER_TOKEN');",
        "const token = await context.secrets.get('API_TOKEN');",
        "return { other, length: token.ok ? token.value.length : 0 };",
      ].join("\n"),
    );
    assert.match(JSON.stringify(outputOf(run)), /"other":\{"ok":false,"kind":"refused".*OTHER_TOKEN/);
    assert.match(JSON.stringify(outputOf(run)), /"length":26/);
    assert.ok(run.events.events.some((event) => event.kind === "refused"));
  });
});

test("a script that returns or prints a secret value has it redacted", async () => {
  await withScriptProject(async (root) => {
    const returned = await attempt(
      root,
      "const token = await context.secrets.get('API_TOKEN'); return { leak: token.ok ? token.value : '' };",
    );
    assert.deepEqual(outputOf(returned), { leak: "[redacted:API_TOKEN]" });
    const failed = await attempt(
      root,
      "const token = await context.secrets.get('API_TOKEN'); fail(`could not use ${token.ok ? token.value : ''}`);",
    );
    assert.equal(reasonOf(failed), "could not use [redacted:API_TOKEN]");
    const crashed = await attempt(
      root,
      "const token = await context.secrets.get('API_TOKEN'); throw new Error(`crash ${token.ok ? token.value : ''}`);",
    );
    assert.match(reasonOf(crashed), /crash \[redacted:API_TOKEN\]/);
    assert.doesNotMatch(JSON.stringify(crashed.events.events), new RegExp(madeUpToken));
  });
});

test("a secret written through context.files.write is redacted in the file, and an event names the file", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(
      root,
      [
        "const token = await context.secrets.get('API_TOKEN');",
        "const value = token.ok ? token.value : '';",
        "const hex = Buffer.from(value).toString('hex');",
        "return await context.files.write('notes-out/leak.txt', `raw ${value} hex ${hex} b64 ${btoa(value)}`);",
      ].join("\n"),
      { permissions: { effects: ["read", "write"] } },
    );
    assert.deepEqual(outputOf(run), { ok: true, value: null });
    const written = await readFile(join(root, "notes-out/leak.txt"), "utf8");
    assert.equal(written, "raw [redacted:API_TOKEN] hex [redacted:API_TOKEN] b64 [redacted:API_TOKEN]");
    const redacted = run.events.events.filter((event) => event.kind === "redacted");
    assert.equal(redacted.length, 1);
    assert.match(JSON.stringify(redacted[0]?.detail), /notes-out\/leak\.txt/);
    assert.doesNotMatch(JSON.stringify(run.events.events), new RegExp(madeUpToken));
  });
});

test("a file written without a secret value is written as given, with no redacted event", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(
      root,
      "return await context.files.write('notes-out/plain.txt', 'password: see the README');",
      { permissions: { effects: ["read", "write"] } },
    );
    assert.deepEqual(outputOf(run), { ok: true, value: null });
    assert.equal(await readFile(join(root, "notes-out/plain.txt"), "utf8"), "password: see the README");
    assert.equal(run.events.events.filter((event) => event.kind === "redacted").length, 0);
  });
});

test("through the broker, a script is refused an undeclared host, http and a redirect elsewhere", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(
      root,
      [
        "const get = (url) => context.http.request({ method: 'GET', url, headers: {} });",
        "return {",
        "  declared: await get('https://api.example.com/x'),",
        "  undeclared: await get('https://evil.example/x'),",
        "  plain: await get('http://api.example.com/x'),",
        "  redirected: await get('https://api.example.com/redirect'),",
        "};",
      ].join("\n"),
      { permissions: { effects: ["read", "network"] } },
    );
    const output = JSON.stringify(outputOf(run));
    assert.match(output, /"declared":\{"ok":true,"value":\{"status":200/);
    assert.match(output, /"undeclared":\{"ok":false,"kind":"refused"/);
    assert.match(output, /"plain":\{"ok":false,"kind":"refused"/);
    assert.match(output, /"redirected":\{"ok":false,"kind":"refused".*evil\.example/);
  });
});

test("through the broker, a read-only action's script is refused a write and another mode's file", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(
      root,
      [
        "return {",
        "  create: await context.db.execute('create table t (x)'),",
        "  attach: await context.db.query(\"attach '.agentbay/data/store.db' as other\"),",
        "  file: await context.files.read('.agentbay/data/store.db'),",
        "};",
      ].join("\n"),
    );
    const output = JSON.stringify(outputOf(run));
    assert.match(output, /"create":\{"ok":false,"kind":"refused".*actions\.look\.effects/);
    assert.match(output, /"attach":\{"ok":false,"kind":"refused"/);
    assert.match(output, /"file":\{"ok":false,"kind":"refused"/);
  });
});

test("a script that never returns is killed at the time limit", async () => {
  await withScriptProject(async (root) => {
    const started = Date.now();
    const run = await attempt(root, "await new Promise(() => setInterval(() => {}, 1000));", {
      timeLimit: 1200,
    });
    assert.match(reasonOf(run), /time limit of 1\.2 seconds/);
    assert.ok(Date.now() - started < 8000);
  });
});

test("a script whose database query never ends is still killed at the time limit", async () => {
  await withScriptProject(async (root) => {
    const started = Date.now();
    const run = await attempt(
      root,
      [
        "await context.db.execute('create table t (x)');",
        "return await context.db.query(",
        "  'with recursive r(n) as (select 1 union all select n + 1 from r) select count(*) from r',",
        ");",
      ].join("\n"),
      { timeLimit: 1800, permissions: { effects: ["read", "write"] } },
    );
    assert.match(reasonOf(run), /time limit of 1\.8 seconds/);
    assert.ok(Date.now() - started < 8000, `took ${String(Date.now() - started)} ms`);
  });
});

test("a busy loop is killed at the time limit too", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(root, "for (;;) {}", { timeLimit: 1200 });
    assert.match(reasonOf(run), /time limit/);
  });
});

test("a run with no minutes left does not start", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(root, "return 'ran';", { timeLimit: 0 });
    assert.match(reasonOf(run), /no time left/);
  });
});

test("a script that prints megabytes is stopped at the output cap", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(root, "for (let i = 0; i < 50; i++) console.log('x'.repeat(100000)); return 'done';", {
      outputBytes: 200_000,
    });
    assert.match(reasonOf(run), /more than 200000 bytes/);
  });
});

test("a script that exits without answering fails", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(root, "process.exit(0);");
    assert.match(reasonOf(run), /ended without returning a result/);
  });
});

test("a script that writes a malformed message to the protocol stream fails", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(
      root,
      "const fs = await import('node:fs'); fs.writeSync(1, '{not json\\n'); await new Promise(() => {});",
    );
    assert.match(reasonOf(run), /not a valid message/);
  });
});

test("a script that sends a forged final message with a value that is not JSON fails", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(
      root,
      [
        "const fs = await import('node:fs');",
        "fs.writeSync(1, JSON.stringify({ type: 'done' }) + '\\n');",
        "await new Promise(() => {});",
      ].join("\n"),
    );
    assert.match(reasonOf(run), /not a valid message/);
  });
});

test("fail(reason) gives a failed outcome with that reason", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(root, "fail('the input names no day');");
    assert.equal(reasonOf(run), "the input names no day");
  });
});

test("a nested call that fails comes back to the script as a failed answer", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(root, "return await context.call('items-store.put', {});", {
      call: () => Promise.resolve({ status: "failed", reason: "store is full", spent: noSpend }),
    });
    assert.deepEqual(outputOf(run), { ok: false, kind: "failed", message: "store is full" });
  });
});

test("a script outside the mode's folder, or one not made with defineScript, does not run", async () => {
  await withScriptProject(async (root) => {
    await writeProjectFile(root, "outside/evil.ts", scriptSource("return 'ran';"));
    assert.match(reasonOf(await runScript(root, { script: "../../../outside/evil.ts" })), /outside the folder/);
    await writeProjectFile(root, "components/modes/notes/scripts/plain.ts", "export const run = () => 'ran';\n");
    assert.match(reasonOf(await runScript(root, { script: "scripts/plain.ts" })), /defineScript/);
    assert.match(reasonOf(await runScript(root, { script: "scripts/missing.ts" })), /could not be loaded|ERR_/);
  });
});

test("spend that is negative or not a number is refused", async () => {
  await withScriptProject(async (root) => {
    const run = await attempt(root, "return [await context.spend({ items: -1 }), await context.spend({ usd: 'x' })];");
    assert.match(JSON.stringify(outputOf(run)), /^\[\{"ok":false,"kind":"refused".*\{"ok":false,"kind":"refused"/);
    assert.equal(run.outcome.spent.items, 0);
  });
});

test("a script sees the caller and the skill input the engine gives it, and none when it gives none", async () => {
  await withProject(async (root) => {
    const body = "  return { caller: context.caller ?? null, skillInput: context.skillInput ?? null };";
    const given = await attempt(root, body, { caller: "briefing", skillInput: { items: ["a:1"] } });
    assert.deepEqual(outputOf(given), { caller: "briefing", skillInput: { items: ["a:1"] } });
    const none = await attempt(root, body);
    assert.deepEqual(outputOf(none), { caller: null, skillInput: null });
  });
});

test("context.now() is the kernel clock's time when the step started, so a fake clock controls it", async () => {
  await withProject(async (root) => {
    const clock = fakeClock(new Date("2026-11-30T23:59:59.000Z"));
    const body = "  return { now: context.now().toISOString(), again: context.now().toISOString() };";
    const before = await attempt(root, body, { clock });
    assert.deepEqual(outputOf(before), { now: "2026-11-30T23:59:59.000Z", again: "2026-11-30T23:59:59.000Z" });
    clock.advance(1000);
    const after = await attempt(root, body, { clock });
    assert.equal(fieldOf(outputOf(after), "now"), "2026-12-01T00:00:00.000Z");
  });
});

test("a script reaches a database partition through its context: migrate, execute, query and agent query", async () => {
  await withProject(async (root) => {
    await writeProjectFile(root, "components/modes/notes/migrations/0001-notes.sql", "create table notes (text text);");
    const body = [
      '  const alpha = context.db.partition("alpha");',
      '  const beta = context.db.partition("beta");',
      "  const migrated = await alpha.migrate();",
      "  await beta.migrate();",
      '  await alpha.execute("insert into notes (text) values (?)", ["in alpha"]);',
      '  const own = await alpha.query("select text from notes");',
      '  const other = await beta.query("select text from notes");',
      '  const agent = await alpha.agentQuery("select count(*) as n from notes");',
      '  const bad = await context.db.partition("../notes").query("select 1");',
      "  return {",
      "    migrated: migrated.ok ? migrated.value : migrated.message,",
      "    own: own.ok ? own.value : own.message,",
      "    other: other.ok ? other.value : other.message,",
      "    agent: agent.ok ? agent.value.rows : agent.message,",
      '    bad: bad.ok ? "granted" : bad.kind,',
      "  };",
    ].join("\n");
    const run = await attempt(root, body, { permissions: { effects: ["read", "write"] } });
    assert.deepEqual(outputOf(run), {
      migrated: ["0001-notes.sql"],
      own: [{ text: "in alpha" }],
      other: [],
      agent: [[1]],
      bad: "refused",
    });
  });
});
