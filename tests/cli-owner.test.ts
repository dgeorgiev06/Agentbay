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

const reviewThenCompose = [
  "name: review",
  "trigger:",
  "  manual: true",
  "steps:",
  "  - id: fetch",
  "    action: greeting-source.fetch",
  "  - id: keep",
  "    approval: Keep this greeting?",
  "    show: $steps.fetch.output",
  "  - id: compose",
  "    action: compose",
  "    input:",
  "      name: Cy",
  "",
].join("\n");

test("approve prints the next skill step's task with its token, for the owner's coordinator", async () => {
  const project = await makeProject();
  try {
    await project.write("components/modes/writer/workflows/review.yaml", reviewThenCompose);
    const approval = await waitingApproval(project);
    const argv = ["approve", approval.runId, "keep", "--hash", approval.hash, "--project", project.root, "--json"];
    const approved = await bay(argv, { terminal: fakeTerminal({ interactive: true, answer: "yes" }) });
    assert.equal(approved.exitCode, 0, approved.output);
    const run = fieldOf(toJson(approved.json), "run") ?? null;
    assert.equal(textField(fieldOf(run, "task") ?? null, "stepKey"), "compose/1#1");
    assert.match(textField(fieldOf(run, "task") ?? null, "token") ?? "", /^[A-Za-z0-9_-]{43}$/);
    assert.equal(textField(run, "notice"), "A task token was issued with this task; it is shown only now.");
  } finally {
    await project.remove();
  }
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

const madeUpSecret = "made-up-notes-token-4d1e9b";

const secretEnvironment = { AGENTBAY_SECRET_NOTES_TOKEN: madeUpSecret };

const signatureReview = [
  "name: review",
  "trigger:",
  "  manual: true",
  "steps:",
  "  - id: fetch",
  "    action: greeting-source.fetch",
  "  - id: keep",
  "    approval: Keep this signature?",
  "    show: $settings.signature",
  "",
].join("\n");

const fetchReadingSecret = [
  'import { defineScript, fail } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const secret = await context.secrets.get("NOTES_TOKEN");',
  "  return secret.ok ? { greeting: `Hello, ${secret.value}` } : fail(secret.message);",
  "});",
  "",
].join("\n");

async function projectShowingSecret(): Promise<Project> {
  const project = await makeProject();
  const greeter = await project.read("components/modes/greeter/mode.yaml");
  await project.write("components/modes/greeter/mode.yaml", `${greeter}resources:\n  secrets:\n    - NOTES_TOKEN\n`);
  await project.write("components/modes/greeter/scripts/fetch.ts", fetchReadingSecret);
  await project.write("components/modes/writer/workflows/review.yaml", signatureReview);
  const config = await project.read("agentbay.config.yaml");
  await project.write("agentbay.config.yaml", config.replace("Yours, the writer", `Yours, ${madeUpSecret}`));
  return project;
}

test("call and runs of a workflow whose approval shows a secret print no secret text", async () => {
  const project = await projectShowingSecret();
  try {
    const call = ["call", "--workflow", "writer:workflows/review.yaml", '{"name":"Cy"}', "--project", project.root];
    const text = await bay(call, { environment: secretEnvironment });
    assert.equal(text.exitCode, 0, text.output);
    assert.match(text.output, /"Yours, \[redacted:NOTES_TOKEN\]"/);
    assert.ok(!text.output.includes(madeUpSecret), text.output);
    const json = await bay([...call, "--json"], { environment: secretEnvironment });
    assert.ok(!json.output.includes(madeUpSecret), json.output);
    const run = fieldOf(toJson(json.json), "run") ?? null;
    const waiting = fieldOf(run, "waiting") ?? null;
    assert.equal(fieldOf(waiting, "content"), "Yours, [redacted:NOTES_TOKEN]");
    const runId = textField(run, "id") ?? "";
    const shown = await bay(["runs", runId, "--project", project.root], { environment: secretEnvironment });
    assert.match(shown.output, /"Yours, \[redacted:NOTES_TOKEN\]"/);
    assert.ok(!shown.output.includes(madeUpSecret), shown.output);
  } finally {
    await project.remove();
  }
});
