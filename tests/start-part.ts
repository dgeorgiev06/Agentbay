import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, isRecord, parseJson, textField, toJson } from "../bay/json.ts";
import { loadKernel } from "../bay/kernel.ts";
import { nodeKernelPorts } from "../bay/kernel-ports.ts";
import { layoutOf } from "../bay/layout.ts";
import { failedWith, succeededWith, unplacedProblem, type Outcome, type Problem } from "../bay/outcome.ts";

type Request = {
  readonly mode: string;
  readonly path: string;
  readonly input: Json;
  readonly given: Readonly<Record<string, Json>>;
  readonly until?: string;
};

const usage = "node tests/start-part.ts <mode>:<path> '<trigger json>' '<part json>'";

const kit = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

function refused(message: string): Outcome<never> {
  return failedWith([unplacedProblem(message, usage)]);
}

function jsonOf(text: string | undefined, what: string): Outcome<Json> {
  try {
    return succeededWith(parseJson(text ?? "{}"));
  } catch {
    return refused(`The ${what} is not JSON: ${text ?? ""}`);
  }
}

function givenOf(part: Json): Readonly<Record<string, Json>> | undefined {
  const given = fieldOf(part, "given") ?? {};
  if (!isRecord(given)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(given).map(([id, output]) => [id, toJson(output)]));
}

export function partRequestOf(words: readonly string[]): Outcome<Request> {
  const [target = "", trigger, partText] = words;
  const separator = target.indexOf(":");
  if (separator <= 0) {
    return refused(`The workflow is named as <mode>:<path>, not ${target}.`);
  }
  const input = jsonOf(trigger, "trigger");
  if (!input.ok) {
    return input;
  }
  const part = jsonOf(partText, "part");
  if (!part.ok) {
    return part;
  }
  const given = givenOf(part.value);
  if (given === undefined) {
    return refused("The part's given is not a mapping of step ids to outputs.");
  }
  const until = textField(part.value, "until");
  const reference = { mode: target.slice(0, separator), path: target.slice(separator + 1) };
  return succeededWith({ ...reference, input: input.value, given, ...(until === undefined ? {} : { until }) });
}

function inATestFolder(folder: string): boolean {
  const temporary = realpathSync(tmpdir());
  return realpathSync(folder).startsWith(`${temporary}${sep}`);
}

async function started(project: string, request: Request): Promise<Outcome<Json>> {
  if (!inATestFolder(project)) {
    return refused(
      `tests/start-part.ts starts a part of a workflow only in a test's project, under ${tmpdir()}; ` +
        `${project} is not under it.`,
    );
  }
  const loaded = await loadKernel({
    layout: layoutOf({ kit, project }),
    ports: nodeKernelPorts(process.env),
    environment: process.env,
    platform: process.platform,
  });
  if (!loaded.ok) {
    return loaded;
  }
  const kernel = loaded.value;
  try {
    const { mode, path, input, given, until } = request;
    const run = await kernel.runs.startPart({ mode, path }, input, {
      given,
      ...(until === undefined ? {} : { until }),
    });
    return run.ok ? succeededWith({ id: run.value.id, status: run.value.state.status }) : run;
  } finally {
    kernel.close();
  }
}

function printed(answer: Outcome<Json>): string {
  if (answer.ok) {
    return JSON.stringify({ ok: true, run: answer.value });
  }
  const problems = answer.problems.map((problem: Problem) => ({ message: problem.message, fix: problem.fix ?? "" }));
  return JSON.stringify({ ok: false, problems });
}

async function main(): Promise<void> {
  const request = partRequestOf(process.argv.slice(2));
  const answer = request.ok ? await started(process.cwd(), request.value) : request;
  process.stdout.write(`${printed(answer)}\n`);
  process.exitCode = answer.ok ? 0 : 1;
}

if (import.meta.main) {
  await main();
}
