import assert from "node:assert/strict";
import { test } from "node:test";
import type { Answer } from "../bay/answers.ts";
import { brokerForStep } from "../bay/broker/broker.ts";
import type { ModeGrants, Scrubber } from "../bay/contracts.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeThrowawayFolders,
  systemClock,
} from "../bay/node-ports.ts";
import { SecretStore } from "../bay/secrets.ts";
import {
  exitedProcess,
  failureOf,
  noProcesses,
  grantsIn,
  place,
  projectLayout,
  recordingProcesses,
  recordingSink,
  refusalOf,
  scriptedHttp,
} from "./broker-fixture.ts";

const permissions = grantsIn("/project", { secrets: ["MAIL_TOKEN", "SHORT_ONE", "MISSING_ONE"] });

const madeUpToken = "made-up-token-value-4242";

async function askedThroughTheBroker(store: SecretStore, name: string, grants: ModeGrants): Promise<Answer<string>> {
  const broker = brokerForStep({
    layout: projectLayout("/project"),
    permissions: { grants, actionEffects: [] },
    place,
    files: nodeFileSystem,
    throwawayFolders: nodeThrowawayFolders,
    inspector: nodeFileInspector,
    http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
    secrets: store,
    events: recordingSink(),
    clock: systemClock,
    childProcesses: nodeChildProcesses,
    processes: noProcesses,
    commandSearchPath: "/usr/bin:/bin",
  });
  try {
    return await broker.entries["secrets.get"]({ name });
  } finally {
    broker.close();
  }
}

function storeWith(environment: Readonly<Record<string, string>>): SecretStore {
  return new SecretStore({ environment, processes: noProcesses, platform: "linux" });
}

test("a secret the permissions list is read from AGENTBAY_SECRET_<NAME>", async () => {
  const store = storeWith({ AGENTBAY_SECRET_MAIL_TOKEN: madeUpToken });
  assert.deepEqual(await store.lookUp("MAIL_TOKEN"), { ok: true, value: madeUpToken });
});

test("a secret the permissions do not list is refused, naming the manifest line to change", async () => {
  const store = storeWith({ AGENTBAY_SECRET_OTHER_TOKEN: madeUpToken });
  const message = refusalOf(await askedThroughTheBroker(store, "OTHER_TOKEN", permissions)).message;
  assert.match(message, /asked for the secret OTHER_TOKEN/);
  assert.match(message, /MAIL_TOKEN, SHORT_ONE, MISSING_ONE/);
  assert.match(message, /resources\.secrets in \/project\/components\/modes\/notes\/mode\.yaml/);
  assert.doesNotMatch(message, new RegExp(madeUpToken));
});

test("only the AGENTBAY_SECRET_ variable is read, never a variable of the bare name", async () => {
  const store = storeWith({ MAIL_TOKEN: madeUpToken });
  assert.match(failureOf(await store.lookUp("MAIL_TOKEN")).message, /AGENTBAY_SECRET_MAIL_TOKEN/);
});

test("a secret shorter than 8 characters is refused, without printing it", async () => {
  const store = storeWith({ AGENTBAY_SECRET_SHORT_ONE: "abc1234" });
  const message = refusalOf(await store.lookUp("SHORT_ONE")).message;
  assert.match(message, /shorter than 8 characters/);
  assert.doesNotMatch(message, /abc1234/);
  assert.equal(store.redact("x abc1234 y"), "x abc1234 y");
});

test("on macOS a secret missing from the environment comes from the keychain, and nothing else", async () => {
  const processes = recordingProcesses(() => exitedProcess(0, `${madeUpToken}\n`, ""));
  const store = new SecretStore({ environment: {}, processes, platform: "darwin" });
  assert.deepEqual(await store.lookUp("MAIL_TOKEN"), { ok: true, value: madeUpToken });
  assert.equal(processes.requests.length, 1);
  assert.equal(processes.requests.at(0)?.command, "security");
  assert.deepEqual(processes.requests.at(0)?.arguments, [
    "find-generic-password",
    "-s",
    "agentbay",
    "-a",
    "MAIL_TOKEN",
    "-w",
  ]);
  assert.deepEqual(processes.requests.at(0)?.environment, {});
});

test("a secret in neither place fails with how to set it", async () => {
  const processes = recordingProcesses(() => exitedProcess(44, "", "not found"));
  const store = new SecretStore({ environment: {}, processes, platform: "darwin" });
  const message = failureOf(await store.lookUp("MISSING_ONE")).message;
  assert.match(message, /security add-generic-password -s agentbay -a MISSING_ONE -w/);
});

test("the keychain is not asked off macOS", async () => {
  const store = new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" });
  failureOf(await store.lookUp("MAIL_TOKEN"));
});

test("a value handed out is redacted raw, in base64, URL-safe base64, URL-encoded and lower or upper hex", async () => {
  const value = "made+up/secret value?&=42";
  const store = storeWith({ AGENTBAY_SECRET_MAIL_TOKEN: value });
  await store.lookUp("MAIL_TOKEN");
  const base64 = Buffer.from(value).toString("base64");
  const urlSafe = Buffer.from(value).toString("base64url");
  const basicAuth = Buffer.from(`someone:${value}`).toString("base64");
  const hex = Buffer.from(value).toString("hex");
  const text = [value, base64, urlSafe, encodeURIComponent(value), `Basic ${basicAuth}`, hex, hex.toUpperCase()].join(
    " | ",
  );
  const redacted = store.redact(text);
  assert.doesNotMatch(redacted, /made\+up/);
  assert.ok(!redacted.includes(base64));
  assert.ok(!redacted.includes(urlSafe));
  assert.ok(!redacted.includes(encodeURIComponent(value)));
  assert.ok(!redacted.includes(basicAuth));
  assert.ok(!redacted.toLowerCase().includes(hex));
  assert.equal(redacted.split("[redacted:MAIL_TOKEN]").length - 1, 7);
  assert.match(redacted, /^\[redacted:MAIL_TOKEN\] \| \[redacted:MAIL_TOKEN\]/);
});

function readsRecorded(environment: Readonly<Record<string, string>>): {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly read: string[];
} {
  const read: string[] = [];
  const recorded = new Proxy(environment, {
    get: (target, key): string | undefined => {
      if (typeof key !== "string") {
        return undefined;
      }
      read.push(key);
      return target[key];
    },
  });
  return { environment: recorded, read };
}

test("a fresh store asks the environment and the keychain only for declared names", async () => {
  const { environment, read } = readsRecorded({ AGENTBAY_SECRET_OTHER_TOKEN: madeUpToken });
  const processes = recordingProcesses(() => exitedProcess(44, "", "not found"));
  const declaredBy = [grantsIn("/project", { secrets: ["MAIL_TOKEN", "NOTES_TOKEN"] })];
  const store = await SecretStore.open({ environment, processes, platform: "darwin", declaredBy });
  assert.deepEqual(read, ["AGENTBAY_SECRET_MAIL_TOKEN", "AGENTBAY_SECRET_NOTES_TOKEN"]);
  assert.deepEqual(
    processes.requests.map((request) => request.arguments),
    [
      ["find-generic-password", "-s", "agentbay", "-a", "MAIL_TOKEN", "-w"],
      ["find-generic-password", "-s", "agentbay", "-a", "NOTES_TOKEN", "-w"],
    ],
  );
  assert.equal(store.redact(`x ${madeUpToken}`), `x ${madeUpToken}`);
});

test("a fresh store opens when a declared secret is not set, and hand-out still says how to set it", async () => {
  const processes = recordingProcesses(() => exitedProcess(44, "", "not found"));
  const declaredBy = [permissions];
  const store = await SecretStore.open({ environment: {}, processes, platform: "darwin", declaredBy });
  assert.equal(store.redact("nothing to hide here"), "nothing to hide here");
  assert.equal(
    failureOf(await store.lookUp("MISSING_ONE")).message,
    "The secret MISSING_ONE is not set. Set AGENTBAY_SECRET_MISSING_ONE in the environment, or on macOS store it " +
      "with `security add-generic-password -s agentbay -a MISSING_ONE -w`.",
  );
});

test("a declared value too short to redact is not learned at open and is refused at hand-out", async () => {
  const environment = { AGENTBAY_SECRET_SHORT_ONE: "abc1234" };
  const store = await SecretStore.open({
    environment,
    processes: noProcesses,
    platform: "linux",
    declaredBy: [permissions],
  });
  assert.equal(store.redact("x abc1234 y"), "x abc1234 y");
  assert.equal(
    refusalOf(await store.lookUp("SHORT_ONE")).message,
    "The step asked for the secret SHORT_ONE, but its value is shorter than 8 characters, too short to redact " +
      "safely. Store a value of at least 8 characters for SHORT_ONE.",
  );
  assert.equal(store.redact("x abc1234 y"), "x abc1234 y");
});

test("text that looks like a secret is scrubbed by pattern even when no value was handed out", () => {
  const store = storeWith({});
  const samples = {
    "private-key": "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    bearer: "Bearer abcdefghijklmnopqrstuvwxyz012345",
    "api-key": `sk-ant-api03-${"a".repeat(40)}`,
    "connection-string": "postgres://someone:made-up-password@db.example.com/main",
    password: "password=Hunter2.Secret!",
    "secret-assignment": "client_secret=AbCdEfGhIjKlMnOpQrStUv",
  };
  for (const [kind, sample] of Object.entries(samples)) {
    const scrubbed = store.redact(`before ${sample} after`);
    assert.match(scrubbed, new RegExp(`\\[redacted:${kind}\\]`), kind);
    assert.match(scrubbed, /^before /, kind);
  }
  for (const sample of ["password=s3cr3t.pass", "api_key=abcdefghijklmnopqrstuvwxyzABCD", "AKIAABCDEFGHIJKLMNOP"]) {
    assert.match(store.redact(sample), /\[redacted:/, sample);
  }
});

test("redaction reaches every string and key of a JSON value", async () => {
  const store = storeWith({ AGENTBAY_SECRET_MAIL_TOKEN: madeUpToken });
  await store.lookUp("MAIL_TOKEN");
  const redacted = store.redactJson({ [madeUpToken]: [1, true, null, { note: `token ${madeUpToken}` }] });
  assert.deepEqual(redacted, { "[redacted:MAIL_TOKEN]": [1, true, null, { note: "token [redacted:MAIL_TOKEN]" }] });
});

test("a declared name that is not upper case with underscores is refused before any lookup", async () => {
  const store = storeWith({ "AGENTBAY_SECRET_mail-token": madeUpToken });
  const answer = await askedThroughTheBroker(store, "mail-token", grantsIn("/project", { secrets: ["mail-token"] }));
  assert.match(refusalOf(answer).message, /upper-case letters, digits and underscores/);
});

test("the secret store is the engine's scrubber", async () => {
  const store = storeWith({ AGENTBAY_SECRET_MAIL_TOKEN: madeUpToken });
  const scrubber: Scrubber = store;
  await store.lookUp("MAIL_TOKEN");
  assert.equal(scrubber.redact(`reason: ${madeUpToken}`), "reason: [redacted:MAIL_TOKEN]");
});

test("ordinary prose that only mentions passwords, tokens, keys or secrets is left unchanged", () => {
  const store = storeWith({});
  for (const text of [
    "exists passwd:denied",
    "password: see the README",
    "token count: 1200",
    "api_key is not set",
    "the secret to good bread: time",
    "secret: tremendously",
    "pwd: /home/someone/projects",
    "password=",
    "the bearer of bad news",
    "refresh_token: none",
  ]) {
    assert.equal(store.redact(text), text, text);
  }
});

test("each pattern still catches a plausible secret value", () => {
  const store = storeWith({});
  const caught: readonly (readonly [string, string])[] = [
    ["password=Hunter2.Secret!", "password"],
    ["password=s3cr3t.pass", "password"],
    ["passwd: 'quoted Pass 42'", "password"],
    ["PWD=Zx9!kLmN", "password"],
    ["api_key=abcdefghijklmnopqrstuvwxyzABCD", "secret-assignment"],
    ["client_secret=AbCdEfGhIjKlMnOpQrStUv", "secret-assignment"],
    ["refresh_token: 1//0gAbCdEfGhIjKl", "secret-assignment"],
    ["Bearer abcdefghijklmnopqrstuvwxyz012345", "bearer"],
  ];
  for (const [text, kind] of caught) {
    assert.match(store.redact(`see ${text}`), new RegExp(`^see \\[redacted:${kind}\\]`), text);
  }
});

const otherMadeUpToken = "other-made-up-value-9090";

test("a fresh store redacts two declared secrets in text, a JSON value and a JSON key, with no hand-out", async () => {
  const store = await SecretStore.open({
    environment: { AGENTBAY_SECRET_MAIL_TOKEN: madeUpToken, AGENTBAY_SECRET_NOTES_TOKEN: otherMadeUpToken },
    processes: noProcesses,
    platform: "linux",
    declaredBy: [grantsIn("/project", { secrets: ["MAIL_TOKEN"] }), grantsIn("/other", { secrets: ["NOTES_TOKEN"] })],
  });
  assert.equal(
    store.redact(`mail ${madeUpToken} notes ${otherMadeUpToken}`),
    "mail [redacted:MAIL_TOKEN] notes [redacted:NOTES_TOKEN]",
  );
  assert.deepEqual(store.redactJson({ [madeUpToken]: [`note ${otherMadeUpToken}`], [otherMadeUpToken]: madeUpToken }), {
    "[redacted:MAIL_TOKEN]": ["note [redacted:NOTES_TOKEN]"],
    "[redacted:NOTES_TOKEN]": "[redacted:MAIL_TOKEN]",
  });
});

test("a declared value of exactly 8 characters is learned at open", async () => {
  const environment = { AGENTBAY_SECRET_MAIL_TOKEN: "abcd1234" };
  const store = await SecretStore.open({
    environment,
    processes: noProcesses,
    platform: "linux",
    declaredBy: [permissions],
  });
  assert.equal(store.redact("x abcd1234 y"), "x [redacted:MAIL_TOKEN] y");
});
