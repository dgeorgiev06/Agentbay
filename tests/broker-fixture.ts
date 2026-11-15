import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import type { Answer, Failure, Refusal } from "../bay/answers.ts";
import type { EventSink, Permissions, RunEvent, StepPlace } from "../bay/contracts.ts";
import type { Mode } from "../bay/generated/mode.ts";
import type { Http, HttpRequest, HttpResponse, ProcessRequest, ProcessResult, Processes } from "../bay/ports.ts";
import type { LoadedMode, System } from "../bay/registry.ts";
import type { Outcome, Problem } from "../bay/spec.ts";

export const kitFolder = fileURLToPath(new URL("..", import.meta.url));

export const sdkFile = join(kitFolder, "bay", "sdk.ts");

export function modeNamed(name: string, resources: Mode["resources"], actions?: Mode["actions"]): Mode {
  return {
    name,
    version: "1.0.0",
    description: `The ${name} mode.`,
    ...(resources === undefined ? {} : { resources }),
    actions: actions ?? {
      look: { input: "schemas/in.json", output: "schemas/out.json", effects: ["read"], run: [{ script: "a.ts" }] },
    },
  };
}

export function systemOf(modes: readonly { readonly folder: string; readonly manifest: Mode }[]): System {
  const loaded = new Map<string, LoadedMode>();
  for (const mode of modes) {
    loaded.set(mode.manifest.name, { ...mode, workflows: new Map(), settings: {} });
  }
  return { modes: loaded, interfaces: new Map(), bindings: new Map(), config: { bindings: {}, adapter: "local" } };
}

export type RecordingSink = EventSink & { readonly events: RunEvent[] };

export function recordingSink(): RecordingSink {
  const events: RunEvent[] = [];
  return {
    events,
    append: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  };
}

export type ScriptedHttp = Http & { readonly requests: HttpRequest[] };

export function scriptedHttp(answer: (request: HttpRequest) => HttpResponse): ScriptedHttp {
  const requests: HttpRequest[] = [];
  return {
    requests,
    request: (request) => {
      requests.push(request);
      return Promise.resolve(answer(request));
    },
  };
}

export type RecordingProcesses = Processes & { readonly requests: ProcessRequest[] };

export function recordingProcesses(answer: (request: ProcessRequest) => ProcessResult): RecordingProcesses {
  const requests: ProcessRequest[] = [];
  return {
    requests,
    run: (request) => {
      requests.push(request);
      return Promise.resolve(answer(request));
    },
  };
}

export const noProcesses: Processes = {
  run: () => Promise.reject(new Error("no process may be started in this test")),
};

export const place: StepPlace = { runId: "run-1", mode: "notes", action: "look", stepIndex: 0 };

export function permissionsIn(root: string, overrides: Partial<Permissions> = {}): Permissions {
  const modeFolder = join(root, "components", "modes", "notes");
  return {
    mode: "notes",
    modeFolder,
    databaseFile: join(root, ".agentbay", "data", "notes.db"),
    readPaths: [modeFolder, join(root, "notes-in")],
    writePaths: [join(root, "notes-out")],
    secrets: [],
    hosts: [],
    commands: [],
    effects: ["read"],
    ...overrides,
  };
}

export async function withProject(run: (root: string) => Promise<void>): Promise<void> {
  const created = await mkdtemp(join(tmpdir(), "agentbay-k3-"));
  const root = await realpath(created);
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function writeProjectFile(root: string, path: string, text: string): Promise<string> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}

export function valueOf<T>(answer: Answer<T>): T {
  if (!answer.ok) {
    assert.fail(`expected a value, got ${answer.kind}: ${answer.message}`);
  }
  return answer.value;
}

export function refusalOf<T>(answer: Answer<T>): Refusal {
  if (answer.ok || answer.kind !== "refused") {
    assert.fail(`expected a refusal, got ${JSON.stringify(answer)}`);
  }
  return answer;
}

export function failureOf<T>(answer: Answer<T>): Failure {
  if (answer.ok || answer.kind !== "failed") {
    assert.fail(`expected a failure, got ${JSON.stringify(answer)}`);
  }
  return answer;
}

export function accepted<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) {
    assert.fail(`expected no problems, got ${JSON.stringify(outcome.problems)}`);
  }
  return outcome.value;
}

export function problemsOf<T>(outcome: Outcome<T>): readonly Problem[] {
  if (outcome.ok) {
    assert.fail("expected problems, got none");
  }
  return outcome.problems;
}
