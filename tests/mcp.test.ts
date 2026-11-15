import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, parseJson, textField } from "../bay/json.ts";
import { replyTo, type ToolServer } from "../bay/mcp-server.ts";
import { issueTaskToken } from "../bay/runs/task-tokens.ts";
import { toolDefinitions } from "../bay/tool-definitions.ts";
import { openKernel, testEnvironment } from "./kernel-fixture.ts";
import { kit, makeProject } from "./project-fixture.ts";
import { listOf } from "./cli-fixture.ts";

type Session = {
  readonly request: (method: string, params?: Json) => Promise<Json>;
  readonly send: (line: string) => void;
  readonly nextLine: () => Promise<string>;
  readonly stderr: () => string;
  readonly stop: () => Promise<number | null>;
};

function session(child: ChildProcessWithoutNullStreams): Session {
  const lines: string[] = [];
  const waiters: ((line: string) => void)[] = [];
  let errors = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    errors += chunk;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter === undefined) {
      lines.push(line);
    } else {
      waiter(line);
    }
  });
  const nextLine = (): Promise<string> => {
    const ready = lines.shift();
    return ready === undefined ? new Promise((resolve) => waiters.push(resolve)) : Promise.resolve(ready);
  };
  let id = 0;
  const send = (line: string): void => {
    child.stdin.write(`${line}\n`);
  };
  return {
    send,
    nextLine,
    stderr: () => errors,
    request: async (method, params) => {
      id += 1;
      send(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }));
      const reply = parseJson(await nextLine());
      assert.equal(fieldOf(reply, "id"), id);
      return reply;
    },
    stop: () =>
      new Promise((resolve) => {
        child.on("close", resolve);
        child.stdin.end();
      }),
  };
}

function startServer(project: string): Session {
  const child = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", join(kit, "bay", "mcp.ts"), "--project", project],
    { env: testEnvironment, stdio: ["pipe", "pipe", "pipe"] },
  );
  return session(child);
}

function resultOf(reply: Json): Json {
  const result = fieldOf(reply, "result");
  assert.ok(result !== undefined, JSON.stringify(reply));
  return result;
}

function toolText(reply: Json): { readonly isError: Json | undefined; readonly text: string } {
  const result = resultOf(reply);
  const first = listOf(fieldOf(result, "content"))[0];
  return { isError: fieldOf(result, "isError"), text: first === undefined ? "" : (textField(first, "text") ?? "") };
}

test("the MCP server answers initialize, lists six tools that each need a token, and refuses a bad token", async () => {
  const project = await makeProject();
  const server = startServer(project.root);
  const initialized = resultOf(await server.request("initialize", { protocolVersion: "2025-06-18", capabilities: {} }));
  assert.equal(fieldOf(initialized, "protocolVersion"), "2025-06-18");
  assert.deepEqual(fieldOf(initialized, "serverInfo"), { name: "agentbay", version: "5.0.0-dev" });
  assert.deepEqual(fieldOf(initialized, "capabilities"), { tools: { listChanged: false } });
  server.send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
  assert.deepEqual(resultOf(await server.request("ping")), {});
  const listed = listOf(fieldOf(resultOf(await server.request("tools/list")), "tools"));
  assert.deepEqual(
    listed.map((tool) => textField(tool, "name")),
    ["db_query", "files_read", "files_list", "files_write", "call_action", "submit"],
  );
  for (const tool of listed) {
    const schema = fieldOf(tool, "inputSchema") ?? null;
    assert.ok(JSON.stringify(fieldOf(schema, "required")).includes('"token"'));
    assert.ok((textField(tool, "description") ?? "").length > 40);
  }
  const refused = toolText(
    await server.request("tools/call", { name: "db_query", arguments: { token: "stolen", sql: "select 1" } }),
  );
  assert.equal(refused.isError, true);
  assert.match(refused.text, /The token is not valid/);
  assert.equal(await server.stop(), 0);
  await project.remove();
});

test("the MCP server accepts a submit with a real token on a real project", async () => {
  const project = await makeProject();
  const kernel = await openKernel(project);
  const started = await kernel.engine.startAction("writer.compose", { name: "Ada" });
  assert.ok(started.ok && started.value.state.status === "waiting" && started.value.state.waiting.reason === "skill");
  const place = { runId: started.value.id, stepKey: started.value.state.waiting.stepKey, round: 1 };
  const token = await issueTaskToken(kernel.store, place, new Date());
  kernel.close();
  const server = startServer(project.root);
  await server.request("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
  const output = { text: "Hello, Ada, and welcome back." };
  const submitted = toolText(await server.request("tools/call", { name: "submit", arguments: { token, output } }));
  assert.equal(submitted.isError, false);
  assert.deepEqual(parseJson(submitted.text), { accepted: true, run: { id: place.runId, status: "done" } });
  assert.equal(await server.stop(), 0);
  assert.equal(await project.read("out/notes/note.txt"), output.text);
  await project.remove();
});

test("the MCP server writes only protocol messages to stdout, even for broken input", async () => {
  const project = await makeProject();
  const server = startServer(project.root);
  server.send("this is not json");
  const parseError = parseJson(await server.nextLine());
  assert.deepEqual(fieldOf(parseError, "error"), { code: -32700, message: "The line is not valid JSON." });
  const unknown = await server.request("resources/list");
  assert.equal(fieldOf(fieldOf(unknown, "error") ?? {}, "code"), -32601);
  server.send(JSON.stringify({ jsonrpc: "1.0", id: 99, method: "ping" }));
  const invalid = parseJson(await server.nextLine());
  assert.equal(fieldOf(fieldOf(invalid, "error") ?? {}, "code"), -32600);
  assert.equal(fieldOf(invalid, "id"), 99);
  assert.deepEqual(resultOf(await server.request("ping")), {});
  assert.equal(await server.stop(), 0);
  await project.remove();
});

test("the MCP server still starts on a broken project and says why every tool is refused", async () => {
  const project = await makeProject();
  await project.write("agentbay.config.yaml", "adapter: fake\n");
  const server = startServer(project.root);
  await server.request("initialize", { protocolVersion: "2025-03-26", capabilities: {} });
  const refused = toolText(await server.request("tools/call", { name: "submit", arguments: { token: "x" } }));
  assert.equal(refused.isError, true);
  assert.match(refused.text, /The project cannot be loaded/);
  assert.equal(await server.stop(), 0);
  assert.match(server.stderr(), /the project cannot be loaded/);
  await project.remove();
});

test("replyTo answers an unknown protocol version with its newest and needs a tool name", async () => {
  const server: ToolServer = {
    definitions: toolDefinitions,
    call: (name) => Promise.resolve({ ok: true, value: { called: name } }),
  };
  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } };
  const reply = parseJson((await replyTo(server, JSON.stringify(initialize))) ?? "");
  assert.equal(fieldOf(fieldOf(reply, "result") ?? {}, "protocolVersion"), "2025-06-18");
  assert.equal(textField(fieldOf(fieldOf(reply, "result") ?? {}, "serverInfo") ?? {}, "name"), "agentbay");
  const nameless = parseJson((await replyTo(server, '{"jsonrpc":"2.0","id":2,"method":"tools/call"}')) ?? "");
  assert.equal(fieldOf(fieldOf(nameless, "error") ?? {}, "code"), -32602);
  const called = parseJson(
    (await replyTo(server, '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"x"}}')) ?? "",
  );
  assert.deepEqual(fieldOf(called, "result"), {
    content: [{ type: "text", text: '{"called":"x"}' }],
    isError: false,
  });
  assert.equal(await replyTo(server, "   "), undefined);
  assert.equal(await replyTo(server, '{"jsonrpc":"2.0","method":"tools/list"}'), undefined);
});
