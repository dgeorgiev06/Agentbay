import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, textField, toJson } from "../bay/json.ts";
import { bay, fakeTerminal, listOf } from "./cli-fixture.ts";
import { makeProject, type Project, type ProjectOptions } from "./project-fixture.ts";

type Approval = {
  readonly runId: string;
  readonly hash: string;
};

async function waitingApproval(project: Project): Promise<Approval> {
  const argv = ["call", "--workflow", "writer:workflows/review.yaml", '{"name":"Cy"}', "--project", project.root];
  const run = fieldOf(toJson((await bay([...argv, "--json"])).json), "run") ?? null;
  const waiting = fieldOf(run, "waiting") ?? null;
  assert.equal(textField(waiting, "reason"), "approval");
  assert.equal(textField(waiting, "question"), "Keep this greeting?");
  assert.deepEqual(fieldOf(waiting, "content"), { greeting: "Hello, Cy" });
  return { runId: textField(run, "id") ?? "", hash: textField(waiting, "hash") ?? "" };
}

async function withApproval(
  options: ProjectOptions,
  body: (project: Project, approval: Approval) => Promise<void>,
): Promise<void> {
  const project = await makeProject(options);
  try {
    await body(project, await waitingApproval(project));
  } finally {
    await project.remove();
  }
}

async function recordedBy(project: Project, runId: string): Promise<Json | undefined> {
  const shown = await bay(["runs", runId, "--events", "--project", project.root, "--json"]);
  const events = listOf(fieldOf(fieldOf(toJson(shown.json), "run") ?? null, "events"));
  const recorded = events.find((event) => textField(event, "kind") === "approval.recorded");
  return recorded === undefined ? undefined : fieldOf(fieldOf(recorded, "detail") ?? null, "by");
}

test("approve from a terminal needs an interactive stdin and a typed yes", async () => {
  await withApproval({}, async (project, approval) => {
    const argv = ["approve", approval.runId, "keep", "--hash", approval.hash, "--project", project.root];
    const piped = await bay(argv, { terminal: fakeTerminal({ interactive: false, answer: "yes" }) });
    assert.equal(piped.exitCode, 1);
    assert.match(piped.output, /needs an interactive terminal \(stdin is not a TTY\)/);
    const declined = fakeTerminal({ interactive: true, answer: "no" });
    assert.equal((await bay(argv, { terminal: declined })).exitCode, 1);
    assert.match(declined.asked[0] ?? "", /Approve Keep this greeting\?\n\{\n {2}"greeting": "Hello, Cy"\n\}/);
    assert.equal(await recordedBy(project, approval.runId), undefined);
    const approved = await bay(argv, { terminal: fakeTerminal({ interactive: true, answer: " YES " }) });
    assert.equal(approved.exitCode, 0, approved.output);
    assert.match(approved.output, /\): done/);
    assert.equal(await recordedBy(project, approval.runId), "owner at the terminal");
  });
});

test("approve --via chat is refused while approvals.from lacks chat, whatever the terminal", async () => {
  await withApproval({}, async (project, approval) => {
    const argv = ["approve", approval.runId, "keep", "--hash", approval.hash, "--project", project.root];
    const chat = await bay([...argv, "--via", "chat", "--quote", "yes keep it"], {
      terminal: fakeTerminal({ interactive: true, answer: "yes" }),
    });
    assert.equal(chat.exitCode, 1);
    assert.match(
      chat.output,
      /Approvals from chat are off: approvals\.from in agentbay\.config\.yaml lists terminal\./,
    );
    assert.equal(await recordedBy(project, approval.runId), undefined);
  });
});

test("approve --via chat, when the config lists chat, records the channel and the owner's quote", async () => {
  await withApproval({ approvalsFrom: ["chat"] }, async (project, approval) => {
    const argv = ["approve", approval.runId, "keep", "--hash", approval.hash, "--project", project.root];
    const terminal = await bay(argv, { terminal: fakeTerminal({ interactive: true, answer: "yes" }) });
    assert.equal(terminal.exitCode, 1);
    assert.match(terminal.output, /Approvals from terminal are off/);
    const rejected = await bay([...argv, "--via", "chat", "--quote", "  no, drop it  ", "--reject", "--json"]);
    assert.equal(rejected.exitCode, 1);
    assert.equal(textField(fieldOf(toJson(rejected.json), "run") ?? null, "status"), "failed");
    assert.equal(await recordedBy(project, approval.runId), 'owner via chat, quoted: "no, drop it"');
  });
});

test("approve always needs the hash of what was shown, and a quote only with chat", async () => {
  await withApproval({ approvalsFrom: ["terminal", "chat"] }, async (project, approval) => {
    const base = ["approve", approval.runId, "keep", "--project", project.root];
    const cases: readonly (readonly [readonly string[], RegExp])[] = [
      [base, /approve needs --hash/],
      [[...base, "--hash", approval.hash, "--quote", "yes"], /--quote goes with --via chat/],
      [[...base, "--hash", approval.hash, "--via", "chat"], /--via chat needs --quote/],
      [[...base, "--hash", approval.hash, "--via", "chat", "--quote", "  "], /--via chat needs --quote/],
      [[...base, "--hash", approval.hash, "--via", "email"], /--via is terminal or chat, not email/],
    ];
    for (const [argv, message] of cases) {
      const ran = await bay(argv);
      assert.equal(ran.exitCode, 2, argv.join(" "));
      assert.match(ran.output, message);
    }
    const wrongHash = await bay([...base, "--hash", "0".repeat(64), "--via", "chat", "--quote", "yes"]);
    assert.equal(wrongHash.exitCode, 1);
    assert.match(wrongHash.output, /is not the hash of what step keep showed/);
  });
});

test("secret set on macOS prints the one keychain command for the owner to run, and reads nothing", async () => {
  const terminal = fakeTerminal({ interactive: true, answer: "typed-value-123" });
  const ran = await bay(["secret", "set", "API_TOKEN", "--json"], { platform: "darwin", terminal });
  assert.equal(ran.exitCode, 0);
  assert.deepEqual(ran.json, {
    ok: true,
    name: "API_TOKEN",
    stored: false,
    command: "security add-generic-password -U -s agentbay -a API_TOKEN -w",
  });
  assert.deepEqual(terminal.asked, []);
  const text = await bay(["secret", "set", "API_TOKEN"], { platform: "darwin" });
  assert.match(
    text.output,
    /Run this yourself in a terminal[^\n]*\n {2}security add-generic-password -U -s agentbay -a API_TOKEN -w\n/,
  );
});

test("secret set elsewhere says how to set the environment variable; a bad name or action is exit 2", async () => {
  const linux = await bay(["secret", "set", "API_TOKEN"]);
  assert.equal(linux.exitCode, 1);
  assert.match(linux.output, /Set AGENTBAY_SECRET_API_TOKEN in the environment/);
  for (const argv of [
    ["secret", "set", "api-token"],
    ["secret", "show", "API_TOKEN"],
    ["secret", "set"],
  ]) {
    assert.equal((await bay(argv)).exitCode, 2, argv.join(" "));
  }
});

const value = "keychain-value-123";

test("secret check says whether a value can be found and never prints it", async () => {
  const found = await bay(["secret", "check", "API_TOKEN", "--json"], {
    environment: { AGENTBAY_SECRET_API_TOKEN: value },
  });
  assert.deepEqual(found.json, { ok: true, name: "API_TOKEN", found: true });
  assert.ok(!found.output.includes(value));
  const text = await bay(["secret", "check", "API_TOKEN"], { environment: { AGENTBAY_SECRET_API_TOKEN: value } });
  assert.equal(text.output, "API_TOKEN is set.");
  const missing = await bay(["secret", "check", "API_TOKEN"]);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.output, /The secret API_TOKEN is not set/);
  const tooShort = await bay(["secret", "check", "API_TOKEN"], { environment: { AGENTBAY_SECRET_API_TOKEN: "abc" } });
  assert.equal(tooShort.exitCode, 1);
  assert.ok(!tooShort.output.includes("abc"));
});
