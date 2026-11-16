import type { Json, RunEvent, Scrubber } from "../contracts.ts";
import { hashOf } from "../json.ts";
import type { RunPatch, RunStore, StepEnd, StoredState } from "./run-store.ts";
import { decodedStepDetail, stepDetailJson, type StepDetail } from "./step-detail.ts";

export type ApprovalContent = {
  readonly content: Json;
  readonly hash: string;
};

export function approvalContentOf(shown: Json, scrubber: Scrubber): ApprovalContent {
  const content = scrubber.redactJson(shown);
  return { content, hash: hashOf(content) };
}

function redactEvents(events: readonly RunEvent[], scrubber: Scrubber): readonly RunEvent[] {
  return events.map((event) => ({ ...event, detail: scrubber.redactJson(event.detail) }));
}

function redactEnd(end: StepEnd, scrubber: Scrubber): StepEnd {
  switch (end.status) {
    case "done":
      return { ...end, output: scrubber.redactJson(end.output) };
    case "failed":
      return { ...end, reason: scrubber.redact(end.reason) };
  }
}

function redactDetail(step: StepDetail, scrubber: Scrubber): StepDetail {
  return decodedStepDetail(step.kind, scrubber.redactJson(stepDetailJson(step)));
}

function redactState(state: StoredState, scrubber: Scrubber): StoredState {
  switch (state.status) {
    case "running":
    case "waiting":
      return state;
    case "done":
      return { ...state, output: scrubber.redactJson(state.output) };
    case "failed":
      return { ...state, reason: scrubber.redact(state.reason) };
    case "undone":
      return { ...state, reason: scrubber.redact(state.reason), undo: scrubber.redactJson(state.undo) };
  }
}

function redactPatch(patch: RunPatch, scrubber: Scrubber): RunPatch {
  return patch.state === undefined ? patch : { ...patch, state: redactState(patch.state, scrubber) };
}

export function scrubbedStore(store: RunStore, scrubber: Scrubber): RunStore {
  const redact = (value: Json): Json => scrubber.redactJson(value);
  const events = (list: readonly RunEvent[]): readonly RunEvent[] => redactEvents(list, scrubber);
  return {
    createRun: (run, owner, list) => store.createRun({ ...run, input: redact(run.input) }, owner, events(list)),
    saveStepInput: (writer, start, list) => {
      const redacted = { ...redactDetail(start, scrubber), key: start.key, input: redact(start.input), at: start.at };
      return store.saveStepInput(writer, redacted, events(list));
    },
    saveStepOutput: (writer, end, list) => store.saveStepOutput(writer, redactEnd(end, scrubber), events(list)),
    saveStepDetail: (writer, change, list) =>
      store.saveStepDetail(writer, { ...redactDetail(change, scrubber), key: change.key, at: change.at }, events(list)),
    saveRefusal: (writer, refusal, list) => {
      const redacted = { ...refusal, input: redact(refusal.input), reason: scrubber.redact(refusal.reason) };
      return store.saveRefusal(writer, redacted, events(list));
    },
    updateRun: (writer, patch, list) => store.updateRun(writer, redactPatch(patch, scrubber), events(list)),
    append: (event) => store.append({ ...event, detail: redact(event.detail) }),
    readRun: (runId) => store.readRun(runId),
    listRuns: (status) => store.listRuns(status),
    readEvents: (runId) => store.readEvents(runId),
    acquire: (runId, owner, now) => store.acquire(runId, owner, now),
    heartbeat: (writer, now) => store.heartbeat(writer, now),
    release: (writer) => store.release(writer),
  };
}
