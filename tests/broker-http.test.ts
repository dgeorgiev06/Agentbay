import assert from "node:assert/strict";
import { test } from "node:test";
import type { Answer } from "../bay/answers.ts";
import { Broker, type BrokerLimits } from "../bay/broker/broker.ts";
import type { HttpRequest, HttpResponse } from "../bay/ports.ts";
import { nodeChildProcesses, nodeFileInspector, nodeFileSystem, nodeThrowawayFolders } from "../bay/node-ports.ts";
import { SecretStore } from "../bay/secrets.ts";
import { fakeClock } from "./fakes.ts";
import {
  failureOf,
  noProcesses,
  permissionsIn,
  place,
  recordingSink,
  refusalOf as refusal,
  scriptedHttp,
  type ScriptedHttp,
  projectLayout,
} from "./broker-fixture.ts";

const madeUpToken = "made-up-bearer-value-9876";

type Setup = {
  readonly broker: Broker;
  readonly http: ScriptedHttp;
  readonly events: ReturnType<typeof recordingSink>;
  readonly secrets: SecretStore;
};

function setup(answer: (request: HttpRequest) => HttpResponse, limits: Partial<BrokerLimits> = {}): Setup {
  const http = scriptedHttp(answer);
  const events = recordingSink();
  const secrets = new SecretStore({
    environment: { AGENTBAY_SECRET_API_TOKEN: madeUpToken },
    processes: noProcesses,
    platform: "linux",
  });
  const broker = new Broker({
    layout: projectLayout("/project"),
    permissions: permissionsIn("/project", {
      hosts: ["api.example.com", "*.files.example.com"],
      secrets: ["API_TOKEN"],
      effects: ["read", "network"],
    }),
    place,
    files: nodeFileSystem,
    throwawayFolders: nodeThrowawayFolders,
    inspector: nodeFileInspector,
    http,
    secrets,
    events,
    clock: fakeClock(new Date("2026-11-14T08:00:00Z")),
    childProcesses: nodeChildProcesses,
    processes: noProcesses,
    commandSearchPath: "/usr/bin:/bin",
    limits,
  });
  return { broker, http, events, secrets };
}

const ok: HttpResponse = { status: 200, headers: { "content-type": "text/plain" }, body: "fine" };

function get(url: string, headers: Readonly<Record<string, string>> = {}): HttpRequest {
  return { method: "GET", url, headers };
}

function refusalOf<T>(answer: Answer<T>): string {
  return refusal(answer).message;
}

test("a request to a declared host over https goes through", async () => {
  const { broker, http } = setup(() => ok);
  assert.deepEqual(await broker.entries["http.request"](get("https://api.example.com/v1/items?x=1")), {
    ok: true,
    value: ok,
  });
  assert.equal(http.requests.length, 1);
});

test("an undeclared host is refused before any request, naming resources.network", async () => {
  const { broker, http, events } = setup(() => ok);
  const message = refusalOf(await broker.entries["http.request"](get("https://evil.example/collect")));
  assert.match(message, /evil\.example/);
  assert.match(message, /api\.example\.com, \*\.files\.example\.com/);
  assert.match(message, /resources\.network in /);
  assert.equal(http.requests.length, 0);
  assert.equal(events.events.filter((event) => event.kind === "refused").length, 1);
});

test("http instead of https is refused, even to a declared host", async () => {
  const { broker, http } = setup(() => ok);
  refusalOf(await broker.entries["http.request"](get("http://api.example.com/v1")));
  refusalOf(await broker.entries["http.request"](get("ftp://api.example.com/v1")));
  refusalOf(await broker.entries["http.request"](get("not a url")));
  assert.equal(http.requests.length, 0);
});

test("a wildcard entry matches subdomains only, and look-alike hosts are refused", async () => {
  const { broker, http } = setup(() => ok);
  assert.equal((await broker.entries["http.request"](get("https://a.files.example.com/x"))).ok, true);
  assert.equal((await broker.entries["http.request"](get("https://a.b.files.example.com/x"))).ok, true);
  refusalOf(await broker.entries["http.request"](get("https://files.example.com/x")));
  refusalOf(await broker.entries["http.request"](get("https://evilfiles.example.com/x")));
  refusalOf(await broker.entries["http.request"](get("https://api.example.com.evil.example/x")));
  refusalOf(await broker.entries["http.request"](get("https://API.example.com:8443/x")));
  refusalOf(await broker.entries["http.request"](get("https://someone:pw@api.example.com/x")));
  assert.equal(http.requests.length, 2);
});

test("a redirect to an undeclared host is refused and not followed", async () => {
  const { broker, http } = setup(() => ({ status: 302, headers: { location: "https://evil.example/x" }, body: "" }));
  const message = refusalOf(await broker.entries["http.request"](get("https://api.example.com/start")));
  assert.match(message, /redirect/);
  assert.match(message, /evil\.example/);
  assert.equal(http.requests.length, 1);
});

test("a redirect to http is refused", async () => {
  const { broker, http } = setup(() => ({ status: 301, headers: { location: "http://api.example.com/x" }, body: "" }));
  refusalOf(await broker.entries["http.request"](get("https://api.example.com/start")));
  assert.equal(http.requests.length, 1);
});

test("redirects between declared hosts are followed hop by hop, dropping credentials on a host change", async () => {
  const { broker, http } = setup((request) => {
    if (request.url === "https://api.example.com/start") {
      return { status: 303, headers: { location: "/next" }, body: "" };
    }
    if (request.url === "https://api.example.com/next") {
      return { status: 307, headers: { location: "https://cdn.files.example.com/blob" }, body: "" };
    }
    return ok;
  });
  const answer = await broker.entries["http.request"]({
    method: "POST",
    url: "https://api.example.com/start",
    headers: { authorization: `Bearer ${madeUpToken}`, "content-type": "text/plain" },
    body: "payload",
  });
  assert.deepEqual(answer, { ok: true, value: ok });
  assert.deepEqual(
    http.requests.map((request) => [request.method, request.url, request.body ?? null]),
    [
      ["POST", "https://api.example.com/start", "payload"],
      ["GET", "https://api.example.com/next", null],
      ["GET", "https://cdn.files.example.com/blob", null],
    ],
  );
  assert.equal(http.requests[1]?.headers.authorization, `Bearer ${madeUpToken}`);
  assert.equal(http.requests[2]?.headers.authorization, undefined);
});

test("too many redirects fail", async () => {
  const { broker, http } = setup(() => ({ status: 302, headers: { location: "/again" }, body: "" }));
  failureOf(await broker.entries["http.request"](get("https://api.example.com/again")));
  assert.equal(http.requests.length, 6);
});

test("request and response bodies are capped", async () => {
  const { broker, http } = setup(() => ({ status: 200, headers: {}, body: "y".repeat(2000) }), {
    httpRequestBytes: 100,
    httpResponseBytes: 1000,
  });
  refusalOf(
    await broker.entries["http.request"]({
      method: "POST",
      url: "https://api.example.com/x",
      headers: {},
      body: "x".repeat(101),
    }),
  );
  assert.equal(http.requests.length, 0);
  assert.match(failureOf(await broker.entries["http.request"](get("https://api.example.com/x"))).message, /1000 bytes/);
});

test("a transport error is a failed answer with a redacted message, not an exception", async () => {
  const { broker, secrets } = setup(() => {
    throw new Error(`connection reset while sending ${madeUpToken}`);
  });
  await secrets.lookUp("API_TOKEN");
  const message = failureOf(await broker.entries["http.request"](get("https://api.example.com/x"))).message;
  assert.doesNotMatch(message, new RegExp(madeUpToken));
  assert.match(message, /connection reset/);
});

test("every request is logged as an event with credentials redacted", async () => {
  const { broker, events, secrets } = setup(() => ok);
  const token = await broker.entries["secrets.get"]({ name: "API_TOKEN" });
  assert.deepEqual(token, { ok: true, value: madeUpToken });
  await broker.entries["http.request"](
    get(`https://api.example.com/x?key=${madeUpToken}`, {
      Authorization: `Bearer ${madeUpToken}`,
      "X-Api-Key": "another-made-up-key-1",
      Accept: "text/plain",
    }),
  );
  const logged = events.events.filter((event) => event.kind === "http");
  assert.equal(logged.length, 1);
  const text = JSON.stringify(logged);
  assert.doesNotMatch(text, new RegExp(madeUpToken));
  assert.doesNotMatch(text, /another-made-up-key-1/);
  assert.match(text, /"Accept":"text\/plain"/);
  assert.equal(logged.at(0)?.runId, "run-1");
  assert.equal(logged.at(0)?.at, "2026-11-14T08:00:00.000Z");
  assert.ok(secrets.redact(madeUpToken).startsWith("[redacted:"));
});

test("an event a script emits is appended after redaction", async () => {
  const { broker, events } = setup(() => ok);
  await broker.entries["secrets.get"]({ name: "API_TOKEN" });
  assert.deepEqual(
    await broker.entries["events.emit"]({ kind: "synced", detail: { note: `token ${madeUpToken}`, count: 3 } }),
    { ok: true, value: null },
  );
  assert.deepEqual(events.events.at(-1), {
    at: "2026-11-14T08:00:00.000Z",
    runId: "run-1",
    kind: "synced",
    detail: { note: "token [redacted:API_TOKEN]", count: 3 },
  });
});

test("a script may not emit an event that looks like a refusal", async () => {
  const { broker, events } = setup(() => ok);
  refusalOf(await broker.entries["events.emit"]({ kind: "refused", detail: { forged: true } }));
  assert.equal(events.events.filter((event) => event.kind === "refused").length, 1);
  assert.match(
    JSON.stringify(events.events[0]?.detail),
    /^\{"resource":"events","step":"look.0","message":"The step look.0 asked/,
  );
  assert.doesNotMatch(JSON.stringify(events.events), /forged/);
});

test("an undeclared secret through the broker is refused and recorded", async () => {
  const { broker, events } = setup(() => ok);
  const message = refusalOf(await broker.entries["secrets.get"]({ name: "OTHER_TOKEN" }));
  assert.match(message, /OTHER_TOKEN/);
  assert.equal(events.events[0]?.kind, "refused");
});

test("a redirect to a host that is not granted is refused at that hop, and nothing is sent to it", async () => {
  const { broker, http, events } = setup((request) => {
    if (request.url === "https://api.example.com/start") {
      return { status: 302, headers: { location: "https://a.files.example.com/next" }, body: "" };
    }
    if (request.url === "https://a.files.example.com/next") {
      return { status: 307, headers: { location: "https://evil.example/collect" }, body: "" };
    }
    return ok;
  });
  const asked = "A request was redirected to https://evil.example/collect";
  const declared = "the mode notes declares the hosts: api.example.com, *.files.example.com";
  const change = "To allow it, add evil.example under resources.network in /project/components/modes/notes/mode.yaml.";
  assert.deepEqual(await broker.entries["http.request"](get("https://api.example.com/start")), {
    ok: false,
    kind: "refused",
    resource: "http",
    asked,
    declared,
    change,
    message: `${asked}, but ${declared}. ${change}`,
  });
  assert.deepEqual(
    http.requests.map((request) => request.url),
    ["https://api.example.com/start", "https://a.files.example.com/next"],
  );
  assert.deepEqual(
    events.events.map((event) => event.kind),
    ["http", "http", "refused"],
  );
});
