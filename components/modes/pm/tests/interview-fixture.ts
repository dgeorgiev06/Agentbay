import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject, type Run } from "../../../../tests/test-toolbox.ts";

export const todoWords = "A todo mode. Add and list, done and remove. Then due dates.";

const glossary = [
  "# The words we use",
  "",
  "| Term | Meaning | Do not say |",
  "|---|---|---|",
  "| **Mode** | A folder with a `mode.yaml`. The unit that is installed. | plugin |",
  "",
].join("\n");

type Waiting = Extract<Run["state"], { readonly status: "waiting" }>["waiting"];

export type Approval = Extract<Waiting, { readonly reason: "approval" }>;

export async function openPm(settings: Readonly<Record<string, Json>> = {}): Promise<ModeProject> {
  const project = await openModeProject({
    bindings: { requirements: "requirements" },
    adapter: "claude-code",
    modes: ["pm", "requirements"],
    settings: { pm: settings },
  });
  await writeFile(join(project.root, "CONTEXT.md"), glossary, "utf8");
  return project;
}

export function waitingOf(run: Run): Waiting {
  const { state } = run;
  return state.status === "waiting"
    ? state.waiting
    : assert.fail(`the run is ${state.status}: ${JSON.stringify(state)}`);
}

export function approvalOf(run: Run): Approval {
  const waiting = waitingOf(run);
  return waiting.reason === "approval" ? waiting : assert.fail(`waits for ${waiting.reason}, not an approval`);
}

export function taskOf(run: Run): {
  readonly token: string;
  readonly input: Json;
  readonly feedback: readonly string[];
} {
  const waiting = waitingOf(run);
  if (waiting.reason !== "skill") {
    return assert.fail(`waits for ${waiting.reason}, not a skill`);
  }
  return { token: waiting.task.token ?? "", input: waiting.task.input, feedback: waiting.task.feedback };
}

export function choose(project: ModeProject, run: Run, choice: string): Promise<Run> {
  const approval = approvalOf(run);
  const by = `owner via chat, quoted: ${JSON.stringify(choice)}`;
  return project.approve(run.id, { stepKey: approval.stepKey, hash: approval.hash, by, choice });
}

export async function started(project: ModeProject, job = "todo"): Promise<Run> {
  const opened = await project.runWorkflow("pm", "workflows/start.yaml", { job, words: todoWords });
  return choose(project, opened, "start");
}

export async function askedTurn(project: ModeProject, job = "todo"): Promise<Run> {
  return project.runWorkflow("pm", "workflows/ask.yaml", { job });
}

export function outputOf(run: Run): Json {
  const { state } = run;
  return state.status === "done" ? state.output : assert.fail(`the run is ${state.status}: ${JSON.stringify(state)}`);
}

function isList(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}

export function listOf(value: Json): readonly Json[] {
  return isList(value) ? value : [];
}

export function failureOf(run: Run): string {
  const { state } = run;
  return state.status === "failed" || state.status === "undone"
    ? state.reason
    : assert.fail(`the run is ${state.status}, not failed: ${JSON.stringify(state)}`);
}

export function fieldOf(value: Json, field: string): Json {
  return fieldsOf(value)[field] ?? null;
}

export const firstTurn: Json = {
  added: [
    {
      id: "Q4",
      title: "Where a mode lives",
      asks: "Where does a mode of the kit live?",
      after: [],
      kind: "fact",
      settled: false,
    },
    {
      id: "Q5",
      title: "Due dates in the past",
      asks: "May a todo be added with a due date that has already passed?",
      after: ["Q2"],
      kind: "decision",
      settled: false,
    },
  ],
  asked: [
    {
      question: "Q1",
      choices: ["The owner, for short tasks", "A team that shares one list"],
      recommended: "a",
      why: "His words name no one else.",
    },
    {
      question: "Q2",
      choices: ["A todo added shows in the open list", "A todo added is sent by mail", "Nothing until a refresh"],
      recommended: "a",
      why: "Add and list are his first words.",
    },
    {
      question: "Q3",
      choices: ["Reminders and sharing", "Nothing is left out"],
      recommended: "a",
      why: "His words name neither.",
    },
  ],
  facts: [],
};

export const factQ4: Json = {
  question: "Q4",
  says: "A mode is a folder with a mode.yaml.",
  source: "CONTEXT.md",
  quote: "A folder with a `mode.yaml`.",
};

export const secondTurn: Json = {
  added: [],
  asked: [
    {
      question: "Q5",
      choices: ["Yes, and it is listed as overdue", "No, it is refused"],
      recommended: "a",
      why: "A person often writes down a task after its date has gone.",
    },
  ],
  facts: [factQ4],
};

export async function answeredAll(project: ModeProject, run: Run, choices: readonly string[]): Promise<Run> {
  let now = run;
  for (const choice of choices) {
    now = await choose(project, now, choice);
  }
  return now;
}
