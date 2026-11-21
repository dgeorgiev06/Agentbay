import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import type { ChildProcesses } from "../bay/ports.ts";
import { fieldOf, textField, toJson } from "../bay/json.ts";
import { bay, fakeTerminal, listOf, type Ran } from "./cli-fixture.ts";
import { makeProject, type Project, type ProjectOptions } from "./project-fixture.ts";

const noProcess: ChildProcesses = {
  start: () => {
    throw new Error("no process could start");
  },
};

const unfinishedQuestion =
  "The step started and did not finish, and its action has effects other than read, so running it again could " +
  "repeat them. Resume with --rerun to run it again.";

const yes = { terminal: fakeTerminal({ interactive: true, answer: "yes" }) };

type Resumed = {
  readonly cause: string;
  readonly by: string | undefined;
};

function runOf(ran: Ran): Json {
  return fieldOf(toJson(ran.json), "run") ?? null;
}

function waitingFor(ran: Ran): string {
  return textField(runOf(ran), "waitingFor") ?? textField(runOf(ran), "status") ?? "";
}

async function withProject(options: ProjectOptions, body: (project: Project) => Promise<void>): Promise<void> {
  const project = await makeProject(options);
  try {
    await body(project);
  } finally {
    await project.remove();
  }
}

async function crashedRun(project: Project): Promise<string> {
  const root = ["--project", project.root];
  await bay(["call", "writer.compose", '{"name":"Ada"}', ...root], { ports: { childProcesses: noProcess } });
  const listed = listOf(fieldOf(toJson((await bay(["runs", ...root, "--json"])).json), "runs"));
  return textField(listed[0] ?? null, "id") ?? "";
}

async function askingRun(project: Project): Promise<string> {
  const runId = await crashedRun(project);
  const asked = await bay(["resume", runId, "--project", project.root, "--json"]);
  assert.equal(waitingFor(asked), "owner", asked.output);
  return runId;
}

function questionOf(ran: Ran): string {
  return textField(fieldOf(runOf(ran), "waiting") ?? null, "question") ?? "";
}

function usageOf(ran: Ran): string {
  return textField(toJson(ran.json), "usage") ?? "";
}

function resume(project: Project, words: readonly string[], terminal = fakeTerminal()): Promise<Ran> {
  return bay(["resume", ...words, "--project", project.root, "--json"], { terminal });
}

async function resumedEvents(project: Project, runId: string): Promise<readonly Resumed[]> {
  const shown = await bay(["runs", runId, "--events", "--project", project.root, "--json"]);
  const events = listOf(fieldOf(runOf(shown), "events"));
  return events
    .filter((event) => textField(event, "kind") === "run.resumed")
    .map((event) => {
      const detail = fieldOf(event, "detail") ?? null;
      return { cause: textField(detail, "cause") ?? "", by: textField(detail, "by") };
    });
}

async function answeredBy(project: Project, runId: string): Promise<readonly string[]> {
  const resumed = await resumedEvents(project, runId);
  return resumed.flatMap((event) => (event.by === undefined ? [] : [`${event.cause}: ${event.by}`]));
}

function problemOf(ran: Ran): string {
  const problems = listOf(fieldOf(toJson(ran.json), "problems"));
  return [textField(problems[0] ?? null, "message"), textField(problems[0] ?? null, "fix")].join("\n");
}

test("resume --rerun of a run that asks the owner needs an interactive terminal and a typed yes, and records it", async () => {
  await withProject({}, async (project) => {
    const runId = await askingRun(project);
    const piped = await resume(project, [runId, "--rerun"], fakeTerminal({ interactive: false, answer: "yes" }));
    assert.equal(piped.exitCode, 1);
    assert.equal(
      problemOf(piped),
      "bay resume --rerun needs an interactive terminal (stdin is not a TTY). Reruns, stops and budget extensions " +
        "are for the owner, not for agents: run it yourself in a terminal, or, if the project config lists chat " +
        "under approvals.from, use --via chat --quote.\n",
    );
    const declined = fakeTerminal({ interactive: true, answer: "no" });
    const notConfirmed = await resume(project, [runId, "--rerun"], declined);
    assert.equal(notConfirmed.exitCode, 1);
    assert.equal(problemOf(notConfirmed), "Not confirmed; nothing changed.\n");
    assert.deepEqual(declined.asked, [
      `${unfinishedQuestion}\nRun ${runId} runs again from where it stopped. Type yes to confirm: `,
    ]);
    assert.deepEqual(await answeredBy(project, runId), []);
    const rerun = await resume(project, [runId, "--rerun"], yes.terminal);
    assert.equal(waitingFor(rerun), "skill", rerun.output);
    assert.deepEqual(await answeredBy(project, runId), ["rerun: owner at the terminal"]);
  });
});

test("resume --rerun and --stop from chat are refused while approvals.from lacks chat, whatever the terminal", async () => {
  await withProject({}, async (project) => {
    const runId = await askingRun(project);
    for (const flag of ["--rerun", "--stop"]) {
      const chat = await resume(project, [runId, flag, "--via", "chat", "--quote", "go on"], yes.terminal);
      assert.equal(chat.exitCode, 1, chat.output);
      assert.equal(
        problemOf(chat),
        "Reruns, stops and budget extensions from chat are off: approvals.from in agentbay.config.yaml lists " +
          "terminal.\nResume from terminal; only the owner changes approvals.from.",
      );
    }
    const shown = await bay(["runs", runId, "--project", project.root, "--json"]);
    assert.equal(waitingFor(shown), "owner");
    assert.deepEqual(await answeredBy(project, runId), []);
  });
});

test("resume --stop from chat, when the config lists chat, needs the owner's words and records them", async () => {
  await withProject({ approvalsFrom: ["chat"] }, async (project) => {
    const runId = await askingRun(project);
    for (const quote of [[], ["--quote", "  "]]) {
      const ran = await resume(project, [runId, "--stop", "--via", "chat", ...quote]);
      assert.equal(ran.exitCode, 2, ran.output);
      assert.equal(usageOf(ran), '--via chat needs --quote "<the owner\'s exact words>".');
    }
    const terminal = await resume(project, [runId, "--stop"], yes.terminal);
    assert.equal(terminal.exitCode, 1);
    assert.match(problemOf(terminal), /^Reruns, stops and budget extensions from terminal are off/);
    const stopped = await resume(project, [runId, "--stop", "--via", "chat", "--quote", "  stop it, please  "]);
    assert.equal(stopped.exitCode, 1, stopped.output);
    const by = 'owner via chat, quoted: "stop it, please"';
    assert.equal(textField(runOf(stopped), "reason"), `${by} stopped the run.`);
    assert.deepEqual(await answeredBy(project, runId), [`stop: ${by}`]);
    const text = await bay(["runs", runId, "--events", "--project", project.root]);
    assert.ok(text.output.includes(`run.resumed  {"cause":"stop","by":${JSON.stringify(by)}}`), text.output);
  });
});

test("each answer records its own words: a later one does not take an earlier quote, and a plain resume none", async () => {
  await withProject({ approvalsFrom: ["chat"] }, async (project) => {
    const runId = await askingRun(project);
    const rerun = await resume(project, [runId, "--rerun", "--via", "chat", "--quote", "run it again"]);
    assert.equal(waitingFor(rerun), "skill", rerun.output);
    assert.equal(waitingFor(await resume(project, [runId])), "skill");
    const stopped = await resume(project, [runId, "--stop", "--via", "chat", "--quote", "now stop"]);
    assert.equal(textField(runOf(stopped), "status"), "failed", stopped.output);
    assert.deepEqual(await resumedEvents(project, runId), [
      { cause: "resume", by: undefined },
      { cause: "rerun", by: 'owner via chat, quoted: "run it again"' },
      { cause: "resume", by: undefined },
      { cause: "stop", by: 'owner via chat, quoted: "now stop"' },
    ]);
  });
});

test("a plain resume decides nothing for the owner: it asks again, needs no source and takes none", async () => {
  await withProject({ approvalsFrom: ["terminal", "chat"] }, async (project) => {
    const runId = await crashedRun(project);
    const asked = await resume(project, [runId]);
    assert.equal(waitingFor(asked), "owner", asked.output);
    const again = await resume(project, [runId]);
    assert.equal(waitingFor(again), "owner", again.output);
    assert.equal(questionOf(again), questionOf(asked));
    assert.deepEqual(await answeredBy(project, runId), []);
    for (const words of [
      ["--via", "chat", "--quote", "run it"],
      ["--via", "terminal"],
      ["--quote", "run it"],
    ]) {
      const ran = await resume(project, [runId, ...words]);
      assert.equal(ran.exitCode, 2, words.join(" "));
      assert.equal(
        usageOf(ran),
        "--via and --quote go with --rerun, --extend or --stop; a plain resume decides nothing for the owner.",
      );
    }
    const due = await resume(project, ["--due", "--via", "chat", "--quote", "wake"]);
    assert.equal(due.exitCode, 2);
    assert.equal(usageOf(due), "--due wakes every due run and takes no run and no other option.");
  });
});

test("resume --rerun of a run left running by a dead engine still runs it again, with the owner's source", async () => {
  await withProject({}, async (project) => {
    const runId = await crashedRun(project);
    const piped = await resume(project, [runId, "--rerun"]);
    assert.equal(piped.exitCode, 1);
    assert.match(problemOf(piped), /^bay resume --rerun needs an interactive terminal/);
    const asked = fakeTerminal({ interactive: true, answer: "yes" });
    const rerun = await resume(project, [runId, "--rerun"], asked);
    assert.equal(waitingFor(rerun), "skill", rerun.output);
    assert.deepEqual(asked.asked, [`Run ${runId} runs again from where it stopped. Type yes to confirm: `]);
    assert.deepEqual(await answeredBy(project, runId), ["rerun: owner at the terminal"]);
  });
});

test("resume --extend raises a spent budget only with the owner's source, and records it", async () => {
  await withProject({}, async (project) => {
    const root = ["--project", project.root];
    const started = await bay(["call", "greeter.tally", '{"name":"Ada"}', ...root, "--json"]);
    const runId = textField(runOf(started), "id") ?? "";
    const piped = await resume(project, [runId, "--extend", "tokens=5"]);
    assert.equal(piped.exitCode, 1);
    assert.match(problemOf(piped), /^bay resume --extend needs an interactive terminal \(stdin is not a TTY\)/);
    assert.equal(waitingFor(await bay(["runs", runId, ...root, "--json"])), "budget");
    const asked = fakeTerminal({ interactive: true, answer: "yes" });
    const extended = await resume(project, [runId, "--extend", "tokens=5"], asked);
    assert.equal(textField(runOf(extended), "status"), "done", extended.output);
    assert.deepEqual(asked.asked, [`The budget of run ${runId} rises by {"tokens":5}. Type yes to confirm: `]);
    assert.deepEqual(await answeredBy(project, runId), ["extend: owner at the terminal"]);
  });
});

test("runs shows a run that asks the owner with both ways to answer, each with where the answer comes from", async () => {
  await withProject({}, async (project) => {
    const runId = await askingRun(project);
    const shown = await bay(["runs", runId, "--project", project.root]);
    const source = '[--via terminal | --via chat --quote "<the owner\'s exact words>"]';
    assert.equal(
      shown.output,
      [
        `run ${runId} (action writer.compose): waiting for owner at 0`,
        unfinishedQuestion,
        `run again with: bay resume ${runId} --rerun ${source}`,
        `or stop with: bay resume ${runId} --stop ${source}`,
        "steps:",
        "  0  script  started",
      ].join("\n"),
    );
  });
});
