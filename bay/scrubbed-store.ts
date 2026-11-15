import type { Json, RunEvent, Scrubber } from "./contracts.ts";
import { toJson, isRecord } from "./json.ts";
import type { RunPatch, RunStore, StepEnd, StoredState } from "./run-store.ts";

export function redactJson(value: Json, scrubber: Scrubber): Json {
  if (typeof value === "string") {
    return scrubber.redact(value);
  }
  if (Array.isArray(value)) {
    return value.map((element: unknown) => redactJson(toJson(element), scrubber));
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).map(([key, element]): [string, Json] => [
      key,
      redactJson(toJson(element), scrubber),
    ]);
    return Object.fromEntries(entries);
  }
  return value;
}

function redactEvents(events: readonly RunEvent[], scrubber: Scrubber): readonly RunEvent[] {
  return events.map((event) => ({ ...event, detail: redactJson(event.detail, scrubber) }));
}

function redactEnd(end: StepEnd, scrubber: Scrubber): StepEnd {
  switch (end.status) {
    case "finished":
      return { ...end, output: redactJson(end.output, scrubber) };
    case "failed":
      return { ...end, reason: scrubber.redact(end.reason) };
  }
}

function redactState(state: StoredState, scrubber: Scrubber): StoredState {
  switch (state.status) {
    case "running":
    case "waiting":
      return state;
    case "done":
      return { ...state, output: redactJson(state.output, scrubber) };
    case "failed":
      return { ...state, reason: scrubber.redact(state.reason) };
    case "undone":
      return { ...state, reason: scrubber.redact(state.reason), undo: redactJson(state.undo, scrubber) };
  }
}

function redactPatch(patch: RunPatch, scrubber: Scrubber): RunPatch {
  return patch.state === undefined ? patch : { ...patch, state: redactState(patch.state, scrubber) };
}

export function scrubbedStore(store: RunStore, scrubber: Scrubber): RunStore {
  const redact = (value: Json): Json => redactJson(value, scrubber);
  const events = (list: readonly RunEvent[]): readonly RunEvent[] => redactEvents(list, scrubber);
  return {
    createRun: (run, owner, list) => store.createRun({ ...run, input: redact(run.input) }, owner, events(list)),
    saveStepInput: (writer, start, list) =>
      store.saveStepInput(writer, { ...start, input: redact(start.input), detail: redact(start.detail) }, events(list)),
    saveStepOutput: (writer, end, list) => store.saveStepOutput(writer, redactEnd(end, scrubber), events(list)),
    saveStepDetail: (writer, change, list) =>
      store.saveStepDetail(writer, { ...change, detail: redact(change.detail) }, events(list)),
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
