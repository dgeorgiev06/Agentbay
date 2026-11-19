import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, isRecord, textField, toJson } from "../bay/json.ts";
import type { Kernel } from "../bay/kernel.ts";
import { problemText, type Outcome } from "../bay/outcome.ts";
import type { Run } from "../bay/runs/runs.ts";
import { callKernelTool } from "../bay/tools.ts";
import { bay } from "./cli-fixture.ts";
import { openKernel, startedTask, type StartedTask } from "./kernel-fixture.ts";
import { kit, makeProject, type Project } from "./project-fixture.ts";

type SkillStepsRun = "with-the-hook" | "without-the-hook";

type Setting = SkillStepsRun | "not set";

const guard = join(kit, "adapters", "claude-code", "step-guard.ts");

const sightingsFile = join(".agentbay", "hook-sightings.db");

const draftAgent = "agentbay-writer-draft";

const goodOutput = { text: "Hello, Ada, and welcome back." };

function refusalSentence(waiting: StartedTask): string {
  return (
    "The kernel did not take this output. This project runs skill steps with the hook, and the agentbay hook " +
    "did not see the agent of skill draft of mode writer hand it in with this task's token. " +
    `Run ${waiting.runId} still waits for step ${waiting.stepKey}. Two ways on: hand the task to that agent in a ` +
    "Claude Code session where the agentbay hook is active, or the owner sets skillSteps.run to " +
    "without-the-hook in agentbay.config.yaml."
  );
}

async function setSkillStepsRun(project: Project, setting: Setting): Promise<void> {
  const config: unknown = parse(await project.read("agentbay.config.yaml"));
  assert.ok(isRecord(config));
  const written = Object.fromEntries(Object.entries(config).filter(([key]) => key !== "skillSteps"));
  const skillSteps = setting === "not set" ? {} : { skillSteps: { run: setting } };
  await project.write("agentbay.config.yaml", stringify({ ...written, ...skillSteps, adapter: "claude-code" }));
}

function stepsPolicy(project: Project): string {
  const root = project.root;
  const rules = (mode: string, skill: string): Json => ({
    mode,
    skill,
    tools: ["mcp__agentbay__submit", "mcp__agentbay__files_write", "Read", "Write", "Edit", "Bash"],
    read: [join(root, "components", "modes", mode), join(root, "out")],
    write: [join(root, "out")],
    commands: ["node --test"],
  });
  const agents = { [draftAgent]: rules("writer", "draft"), "agentbay-greeter-greet": rules("greeter", "greet") };
  return `${JSON.stringify({ version: 1, project: root, kit, agents }, null, 2)}\n`;
}

async function hookedProject(setting: Setting): Promise<Project> {
  const project = await makeProject();
  await setSkillStepsRun(project, setting);
  await project.write(".agentbay/steps.json", stepsPolicy(project));
  return project;
}

type HookRun = { readonly status: number | null; readonly stdout: string };

function hookSees(project: Project, call: { tool: string; input: Json; agent?: string }): HookRun {
  const identity = call.agent === undefined ? {} : { agent_id: "agent-7", agent_type: call.agent };
  const payload = { session_id: "s", cwd: project.root, tool_name: call.tool, tool_input: call.input, ...identity };
  const ran = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", guard, "--project", project.root], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  return { status: ran.status, stdout: ran.stdout };
}

function hookSeesSubmit(project: Project, token: string, from: { agent: string } | "main session"): void {
  const ran = hookSees(project, {
    tool: "mcp__agentbay__submit",
    input: { token, output: goodOutput },
    ...(from === "main session" ? {} : from),
  });
  assert.deepEqual(ran, { status: 0, stdout: "" });
}

function draftSubmitSeen(project: Project, token: string): void {
  hookSeesSubmit(project, token, { agent: draftAgent });
}

function submitted(kernel: Kernel, token: string): Promise<Outcome<Json>> {
  return callKernelTool(kernel, "submit", { token, output: goodOutput });
}

function acceptedValue(result: Outcome<Json>): Json {
  assert.ok(result.ok, result.ok ? "" : problemText(result.problems));
  assert.equal(fieldOf(result.value, "accepted"), true, JSON.stringify(result.value));
  return result.value;
}

function refusalOf(result: Outcome<Json>): string {
  assert.ok(result.ok, result.ok ? "" : problemText(result.problems));
  assert.equal(fieldOf(result.value, "accepted"), false, JSON.stringify(result.value));
  const problems = fieldOf(result.value, "problems");
  assert.ok(Array.isArray(problems), JSON.stringify(result.value));
  return problems.join("\n");
}

async function shownRun(kernel: Kernel, runId: string): Promise<Run> {
  const shown = await kernel.runs.show(runId);
  assert.ok(shown.ok, shown.ok ? "" : problemText(shown.problems));
  return shown.value;
}

async function hookNotes(kernel: Kernel, runId: string): Promise<readonly Json[]> {
  const run = await shownRun(kernel, runId);
  return run.events.filter((event) => event.kind === "skill.hook").map((event) => event.detail);
}

async function assertStillWaits(kernel: Kernel, waiting: StartedTask): Promise<void> {
  const { state } = await shownRun(kernel, waiting.runId);
  assert.ok(state.status === "waiting", JSON.stringify(state));
  assert.deepEqual([state.waiting.reason, state.waiting.stepKey], ["skill", waiting.stepKey]);
}

type Scene = { readonly project: Project; readonly kernel: Kernel; readonly waiting: StartedTask };

async function inScene(setting: Setting, body: (scene: Scene) => Promise<void>): Promise<void> {
  const project = await hookedProject(setting);
  const kernel = await openKernel(project);
  try {
    const waiting = await startedTask(kernel, "writer.compose", { name: "Ada" });
    await body({ project, kernel, waiting });
  } finally {
    kernel.close();
    await project.remove();
  }
}

test("with the hook by default: an output whose submit the hook saw from the step's agent is taken and recorded as seen", async () => {
  await inScene("not set", async ({ project, kernel, waiting }) => {
    draftSubmitSeen(project, waiting.token);
    acceptedValue(await submitted(kernel, waiting.token));
    assert.equal((await shownRun(kernel, waiting.runId)).state.status, "done");
    assert.deepEqual(await hookNotes(kernel, waiting.runId), [
      { stepKey: waiting.stepKey, hookSaw: true, skillSteps: "with-the-hook" },
    ]);
  });
});

test("with the hook: an output the hook never saw is refused with the sentence, and the run still waits", async () => {
  await inScene("with-the-hook", async ({ kernel, waiting }) => {
    assert.equal(refusalOf(await submitted(kernel, waiting.token)), refusalSentence(waiting));
    await assertStillWaits(kernel, waiting);
    assert.deepEqual(await hookNotes(kernel, waiting.runId), []);
  });
});

test("the refusal reaches bay submit on the command line with the same sentence", async () => {
  await inScene("not set", async ({ project, waiting }) => {
    const ran = await bay(["submit", JSON.stringify(goodOutput), "--token", waiting.token, "--project", project.root]);
    assert.equal(ran.exitCode, 1, ran.output);
    assert.ok(ran.output.includes(refusalSentence(waiting)), ran.output);
  });
});

test("without the hook: the output is taken and the run records that no hook saw it", async () => {
  await inScene("without-the-hook", async ({ kernel, waiting }) => {
    acceptedValue(await submitted(kernel, waiting.token));
    assert.equal((await shownRun(kernel, waiting.runId)).state.status, "done");
    assert.deepEqual(await hookNotes(kernel, waiting.runId), [
      { stepKey: waiting.stepKey, hookSaw: false, skillSteps: "without-the-hook" },
    ]);
  });
});

test("without the hook, a submit the hook did see is recorded as seen", async () => {
  await inScene("without-the-hook", async ({ project, kernel, waiting }) => {
    draftSubmitSeen(project, waiting.token);
    acceptedValue(await submitted(kernel, waiting.token));
    assert.deepEqual(await hookNotes(kernel, waiting.runId), [
      { stepKey: waiting.stepKey, hookSaw: true, skillSteps: "without-the-hook" },
    ]);
  });
});

test("the setting in force when the answer arrives decides, in either direction, on the same open kernel", async () => {
  await inScene("without-the-hook", async ({ project, kernel, waiting }) => {
    await setSkillStepsRun(project, "with-the-hook");
    assert.equal(refusalOf(await submitted(kernel, waiting.token)), refusalSentence(waiting));
    await assertStillWaits(kernel, waiting);
  });
  await inScene("with-the-hook", async ({ project, kernel, waiting }) => {
    await setSkillStepsRun(project, "without-the-hook");
    acceptedValue(await submitted(kernel, waiting.token));
    assert.deepEqual(await hookNotes(kernel, waiting.runId), [
      { stepKey: waiting.stepKey, hookSaw: false, skillSteps: "without-the-hook" },
    ]);
  });
});

test("a second answer after a refusal is taken once the hook sees it, with the same token", async () => {
  await inScene("with-the-hook", async ({ project, kernel, waiting }) => {
    assert.equal(refusalOf(await submitted(kernel, waiting.token)), refusalSentence(waiting));
    draftSubmitSeen(project, waiting.token);
    acceptedValue(await submitted(kernel, waiting.token));
    assert.equal((await shownRun(kernel, waiting.runId)).state.status, "done");
  });
});

test("one sighting lets one answer through: an answer taken uses it up", async () => {
  await inScene("with-the-hook", async ({ project, kernel, waiting }) => {
    draftSubmitSeen(project, waiting.token);
    const short = await callKernelTool(kernel, "submit", { token: waiting.token, output: { text: 1 } });
    assert.ok(short.ok);
    assert.equal(fieldOf(short.value, "accepted"), false);
    assert.equal(refusalOf(await submitted(kernel, waiting.token)), refusalSentence(waiting));
  });
});

test("across a kernel restart: a refusal leaves the run waiting, and a sighting made before the restart is used after it", async () => {
  const project = await hookedProject("with-the-hook");
  try {
    const first = await openKernel(project);
    const waiting = await startedTask(first, "writer.compose", { name: "Ada" });
    assert.equal(refusalOf(await submitted(first, waiting.token)), refusalSentence(waiting));
    draftSubmitSeen(project, waiting.token);
    first.close();
    const restarted = await openKernel(project);
    try {
      await assertStillWaits(restarted, waiting);
      acceptedValue(await submitted(restarted, waiting.token));
      assert.deepEqual(await hookNotes(restarted, waiting.runId), [
        { stepKey: waiting.stepKey, hookSaw: true, skillSteps: "with-the-hook" },
      ]);
    } finally {
      restarted.close();
    }
  } finally {
    await project.remove();
  }
});

test("a sighting of another step's token, or of this token by another step's agent or by the main session, is not counted", async () => {
  await inScene("with-the-hook", async ({ project, kernel, waiting }) => {
    const other = await startedTask(kernel, "writer.compose", { name: "Bea" });
    draftSubmitSeen(project, other.token);
    hookSeesSubmit(project, waiting.token, { agent: "agentbay-greeter-greet" });
    hookSeesSubmit(project, waiting.token, "main session");
    assert.equal(refusalOf(await submitted(kernel, waiting.token)), refusalSentence(waiting));
    acceptedValue(await submitted(kernel, other.token));
  });
});

test("an adapter with no hook never sees a step, so with the hook its answers are refused", async () => {
  await inScene("with-the-hook", async ({ project, kernel, waiting }) => {
    draftSubmitSeen(project, waiting.token);
    const config: unknown = parse(await project.read("agentbay.config.yaml"));
    assert.ok(isRecord(config));
    await project.write("agentbay.config.yaml", stringify({ ...config, adapter: "fake" }));
    assert.equal(refusalOf(await submitted(kernel, waiting.token)), refusalSentence(waiting));
  });
});

test("only the project's own setting counts: a mode's settings or a config file in a mode's folder do not", async () => {
  await inScene("not set", async ({ project, kernel, waiting }) => {
    const writer = "components/modes/writer";
    const settingsSchema = {
      type: "object",
      additionalProperties: false,
      properties: { signature: { type: "string" }, skillSteps: { type: "object" } },
    };
    await project.write(`${writer}/schemas/settings.json`, JSON.stringify(settingsSchema));
    await project.write(`${writer}/agentbay.config.yaml`, stringify({ skillSteps: { run: "without-the-hook" } }));
    const config: unknown = parse(await project.read("agentbay.config.yaml"));
    assert.ok(isRecord(config));
    const settings = { writer: { signature: "Yours", skillSteps: { run: "without-the-hook" } } };
    await project.write("agentbay.config.yaml", stringify({ ...config, settings }));
    assert.equal(refusalOf(await submitted(kernel, waiting.token)), refusalSentence(waiting));
    await assertStillWaits(kernel, waiting);
  });
});

test("a submit the hook denies, or one without a subagent id, records no sighting", async () => {
  await inScene("with-the-hook", async ({ project, kernel, waiting }) => {
    const policy = stepsPolicy(project);
    const withoutSubmit = policy.replaceAll('"mcp__agentbay__submit",', "");
    await project.write(".agentbay/steps.json", withoutSubmit);
    const denied = hookSees(project, {
      tool: "mcp__agentbay__submit",
      input: { token: waiting.token, output: goodOutput },
      agent: draftAgent,
    });
    assert.equal(denied.status, 2, denied.stdout);
    await project.write(".agentbay/steps.json", policy);
    const payload = {
      session_id: "s",
      cwd: project.root,
      tool_name: "mcp__agentbay__submit",
      tool_input: { token: waiting.token, output: goodOutput },
      agent_type: draftAgent,
    };
    const ran = spawnSync(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", guard, "--project", project.root],
      {
        input: JSON.stringify(payload),
        encoding: "utf8",
      },
    );
    assert.equal(ran.status, 0, ran.stdout);
    assert.equal(refusalOf(await submitted(kernel, waiting.token)), refusalSentence(waiting));
  });
});

function sightingsCount(project: Project): number {
  const database = new DatabaseSync(join(project.root, sightingsFile), { readOnly: true });
  try {
    const row = database.prepare("select count(*) as count from sightings").get();
    return typeof row?.["count"] === "number" ? row["count"] : -1;
  } finally {
    database.close();
  }
}

function assertDenied(ran: HookRun): void {
  assert.equal(ran.status, 2, ran.stdout);
  assert.match(ran.stdout, /"permissionDecision":"deny"/);
}

test("a step agent cannot mark its own step as seen with any tool it has", async () => {
  await inScene("with-the-hook", async ({ project, kernel, waiting }) => {
    const file = join(project.root, sightingsFile);
    const hash = createHash("sha256").update(waiting.token, "utf8").digest("hex");
    const row = `insert into sightings (token_hash, agent, mode, skill, seen_at) values ('${hash}', '${draftAgent}', 'writer', 'draft', 'now')`;
    draftSubmitSeen(project, "a token of no task");
    assert.equal(sightingsCount(project), 1);
    const attempts = [
      { tool: "Write", input: { file_path: file, content: row } },
      { tool: "Edit", input: { file_path: file, old_string: "a", new_string: row } },
      { tool: "Bash", input: { command: `sqlite3 ${file} "${row}"` } },
      { tool: "Bash", input: { command: `node --test --eval "${row}"` } },
      {
        tool: "Bash",
        input: { command: `node -e "new (require('node:sqlite').DatabaseSync)('${file}').exec(\\"${row}\\")"` },
      },
      {
        tool: "Write",
        input: { file_path: join(project.root, "out", "..", ".agentbay", "hook-sightings.db"), content: row },
      },
    ];
    for (const attempt of attempts) {
      assertDenied(hookSees(project, { ...attempt, agent: draftAgent }));
    }
    const kernelWrite = await callKernelTool(kernel, "files_write", {
      token: waiting.token,
      path: sightingsFile,
      text: row,
    });
    assert.ok(!kernelWrite.ok);
    assert.equal(sightingsCount(project), 1);
    assert.equal(refusalOf(await submitted(kernel, waiting.token)), refusalSentence(waiting));
  });
});

test("text written where the sightings are kept, as a Write would without the hook, is not believed", async () => {
  await inScene("with-the-hook", async ({ project, kernel, waiting }) => {
    const hash = createHash("sha256").update(waiting.token, "utf8").digest("hex");
    const forged = JSON.stringify({
      sightings: [{ token_hash: hash, agent: draftAgent, mode: "writer", skill: "draft" }],
    });
    await writeFile(join(project.root, sightingsFile), forged, "utf8");
    assert.equal(refusalOf(await submitted(kernel, waiting.token)), refusalSentence(waiting));
    await assertStillWaits(kernel, waiting);
  });
});

test("the kernel's own record of a taken answer is not a sighting: an answer still needs the hook", async () => {
  await inScene("with-the-hook", async ({ project, kernel, waiting }) => {
    draftSubmitSeen(project, waiting.token);
    const short = await callKernelTool(kernel, "submit", { token: waiting.token, output: { text: "too short" } });
    assert.ok(short.ok);
    const next = textField(short.value, "token");
    assert.ok(next !== undefined, JSON.stringify(short.value));
    assert.equal(
      refusalOf(await submitted(kernel, next)),
      refusalSentence({ ...waiting, stepKey: textField(short.value, "stepKey") ?? "", token: next }),
    );
  });
});

test("bay check says which way the project runs, and warns only when it runs without the hook", async () => {
  const project = await hookedProject("not set");
  try {
    const withHook = await bay(["check", "--project", project.root, "--json"]);
    assert.equal(fieldOf(toJson(withHook.json), "skillSteps"), "with-the-hook");
    const withText = await bay(["check", "--project", project.root]);
    assert.ok(
      withText.output.includes(
        "Skill steps run with the hook: the kernel takes a skill step's output only when the agentbay hook saw " +
          "the step's agent hand it in.",
      ),
      withText.output,
    );
    assert.ok(!withText.output.includes("without-the-hook"), withText.output);
    await setSkillStepsRun(project, "without-the-hook");
    const withoutHook = await bay(["check", "--project", project.root, "--json"]);
    assert.equal(fieldOf(toJson(withoutHook.json), "skillSteps"), "without-the-hook");
    const withoutText = await bay(["check", "--project", project.root]);
    assert.ok(
      withoutText.output.includes(
        "agentbay.config.yaml: warning: Skill steps run without the hook (skillSteps.run: without-the-hook). " +
          "The kernel takes a skill step's output that no hook saw, and the run records that no hook saw it. " +
          "No hook stops a step's agent from reading or writing outside its lists while it works, and the kernel " +
          "cannot tell an output of the step's agent from one the main session handed in.",
      ),
      withoutText.output,
    );
    assert.ok(
      withoutText.output.includes(
        "  fix: Only the owner changes this. To run with the hook, set skillSteps.run to with-the-hook, run bay " +
          "build, and work in a Claude Code session where the agentbay hook is active.",
      ),
      withoutText.output,
    );
  } finally {
    await project.remove();
  }
});
