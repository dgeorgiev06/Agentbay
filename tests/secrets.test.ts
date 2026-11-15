import assert from "node:assert/strict";
import { test } from "node:test";
import type { Scrubber } from "../bay/contracts.ts";
import { SecretStore } from "../bay/secrets.ts";
import { failureOf, noProcesses, permissionsIn, recordingProcesses, refusalOf } from "./broker-fixture.ts";

const permissions = permissionsIn("/project", { secrets: ["MAIL_TOKEN", "SHORT_ONE", "MISSING_ONE"] });

const madeUpToken = "made-up-token-value-4242";

function storeWith(environment: Readonly<Record<string, string>>): SecretStore {
  return new SecretStore({ environment, processes: noProcesses, platform: "linux" });
}

test("a secret the permissions list is read from AGENTBAY_SECRET_<NAME>", async () => {
  const store = storeWith({ AGENTBAY_SECRET_MAIL_TOKEN: madeUpToken });
  assert.deepEqual(await store.get("MAIL_TOKEN", permissions), { ok: true, value: madeUpToken });
});

test("a secret the permissions do not list is refused, naming the manifest line to change", async () => {
  const store = storeWith({ AGENTBAY_SECRET_OTHER_TOKEN: madeUpToken });
  const message = refusalOf(await store.get("OTHER_TOKEN", permissions)).message;
  assert.match(message, /asked for the secret OTHER_TOKEN/);
  assert.match(message, /MAIL_TOKEN, SHORT_ONE, MISSING_ONE/);
  assert.match(message, /resources\.secrets in \/project\/components\/modes\/notes\/mode\.yaml/);
  assert.doesNotMatch(message, new RegExp(madeUpToken));
});

test("only the AGENTBAY_SECRET_ variable is read, never a variable of the bare name", async () => {
  const store = storeWith({ MAIL_TOKEN: madeUpToken });
  assert.match(failureOf(await store.get("MAIL_TOKEN", permissions)).message, /AGENTBAY_SECRET_MAIL_TOKEN/);
});

test("a secret shorter than 8 characters is refused, without printing it", async () => {
  const store = storeWith({ AGENTBAY_SECRET_SHORT_ONE: "abc1234" });
  const message = refusalOf(await store.get("SHORT_ONE", permissions)).message;
  assert.match(message, /shorter than 8 characters/);
  assert.doesNotMatch(message, /abc1234/);
  assert.equal(store.redact("x abc1234 y"), "x abc1234 y");
});

test("on macOS a secret missing from the environment comes from the keychain, and nothing else", async () => {
  const processes = recordingProcesses(() => ({ exitCode: 0, stdout: `${madeUpToken}\n`, stderr: "" }));
  const store = new SecretStore({ environment: {}, processes, platform: "darwin" });
  assert.deepEqual(await store.get("MAIL_TOKEN", permissions), { ok: true, value: madeUpToken });
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
  const processes = recordingProcesses(() => ({ exitCode: 44, stdout: "", stderr: "not found" }));
  const store = new SecretStore({ environment: {}, processes, platform: "darwin" });
  const message = failureOf(await store.get("MISSING_ONE", permissions)).message;
  assert.match(message, /security add-generic-password -s agentbay -a MISSING_ONE -w/);
});

test("the keychain is not asked off macOS", async () => {
  const store = new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" });
  failureOf(await store.get("MAIL_TOKEN", permissions));
});

test("a value handed out is redacted raw, in base64, URL-safe base64, URL-encoded and lower or upper hex", async () => {
  const value = "made+up/secret value?&=42";
  const store = storeWith({ AGENTBAY_SECRET_MAIL_TOKEN: value });
  await store.get("MAIL_TOKEN", permissions);
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

test("a value never handed out is not remembered", () => {
  const store = storeWith({ AGENTBAY_SECRET_MAIL_TOKEN: madeUpToken });
  assert.equal(store.redact(`x ${madeUpToken}`), `x ${madeUpToken}`);
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
  await store.get("MAIL_TOKEN", permissions);
  const redacted = store.redactJson({ [madeUpToken]: [1, true, null, { note: `token ${madeUpToken}` }] });
  assert.deepEqual(redacted, { "[redacted:MAIL_TOKEN]": [1, true, null, { note: "token [redacted:MAIL_TOKEN]" }] });
});

test("a declared name that is not upper case with underscores is refused before any lookup", async () => {
  const store = storeWith({ "AGENTBAY_SECRET_mail-token": madeUpToken });
  const answer = await store.get("mail-token", permissionsIn("/project", { secrets: ["mail-token"] }));
  assert.match(refusalOf(answer).message, /upper-case letters, digits and underscores/);
});

test("the secret store is the engine's scrubber", async () => {
  const store = storeWith({ AGENTBAY_SECRET_MAIL_TOKEN: madeUpToken });
  const scrubber: Scrubber = store;
  await store.get("MAIL_TOKEN", permissions);
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
