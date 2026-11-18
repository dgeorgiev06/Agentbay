import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { fieldOf, textField, toJson } from "../bay/json.ts";
import { bay, type Ran } from "./cli-fixture.ts";
import { makeProject, type Project } from "./project-fixture.ts";

type Placeholders = Readonly<Record<string, string>>;

const goToolchain = "go-toolchain";

const goToolchainFiles: Readonly<Record<string, string>> = {
  "mode.yaml": JSON.stringify({
    name: goToolchain,
    version: "1.0.0",
    description: "Runs the go tool for a project written in Go.",
    actions: {
      vet: {
        description: "When the owner wants go vet run.",
        input: "schemas/empty.json",
        output: "schemas/empty.json",
        effects: ["read"],
        run: [{ script: "scripts/vet.ts" }],
      },
    },
    resources: { commandsStartWith: "go", commands: { vet: { run: "vet ./...", effects: ["read"] } } },
  }),
  "scripts/vet.ts": "export {};\n",
  "schemas/empty.json": '{ "type": "object", "additionalProperties": false }\n',
};

const takeScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => input);",
  "",
].join("\n");

const shipMode = {
  name: "shipper",
  version: "1.0.0",
  description: "Asks the owner whether to ship.",
  actions: {
    take: {
      description: "When a workflow passes its input on.",
      input: "schemas/anything.json",
      output: "schemas/anything.json",
      effects: ["read"],
      run: [{ script: "scripts/take.ts" }],
    },
  },
  workflows: ["workflows/ship.yaml"],
};

const shipWorkflow = {
  name: "ship",
  trigger: { manual: true },
  steps: [
    { id: "offer", action: "take" },
    {
      id: "decide",
      approval: "Ship it?",
      show: "$steps.offer.output",
      choices: { ship: { does: "Ship it now" }, hold: { does: "Hold it for a week" } },
    },
    { id: "after", action: "take", input: { taken: "$steps.decide.output.choice" } },
  ],
};

async function withBuiltProject(body: (project: Project, coordinator: string) => Promise<void>): Promise<void> {
  const project = await makeProject({ adapter: "claude-code", approvalsFrom: ["chat"] });
  try {
    for (const [path, text] of Object.entries(goToolchainFiles)) {
      await project.write(`components/modes/${goToolchain}/${path}`, text);
    }
    await project.write("components/modes/shipper/mode.yaml", stringify(shipMode));
    await project.write("components/modes/shipper/schemas/anything.json", '{ "type": "object" }\n');
    await project.write("components/modes/shipper/scripts/take.ts", takeScript);
    await project.write("components/modes/shipper/workflows/ship.yaml", stringify(shipWorkflow));
    const built = await bay(["build", "--project", project.root]);
    assert.equal(built.exitCode, 0, built.output);
    await body(project, await project.read("CLAUDE.md"));
  } finally {
    await project.remove();
  }
}

function approveCommands(coordinator: string): readonly string[] {
  const quoted = [...coordinator.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
  return quoted.filter((command) => / approve /.test(command));
}

function commandLike(coordinator: string, pattern: RegExp): string {
  const found = approveCommands(coordinator).filter((command) => pattern.test(command));
  assert.equal(found.length, 1, `one approve command like ${String(pattern)}, found: ${JSON.stringify(found)}`);
  return found[0] ?? "";
}

function wordsOf(command: string): readonly string[] {
  return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function filled(command: string, placeholders: Placeholders): readonly string[] {
  const text = command.replace(/<[^>]+>/g, (placeholder) => {
    const value = placeholders[placeholder];
    assert.ok(value !== undefined, `the coordinator's command ${command} has the placeholder ${placeholder}`);
    return value;
  });
  const [, ...argv] = wordsOf(text);
  return argv;
}

function ranAsWritten(command: string, placeholders: Placeholders): Promise<Ran> {
  return bay(filled(command, placeholders));
}

test("the coordinator's command for an approval, filled from what bay printed when the run stopped, is accepted", async () => {
  await withBuiltProject(async (project, coordinator) => {
    const call = ["call", "--workflow", "writer:workflows/review.yaml", '{"name":"Cy"}', "--project", project.root];
    const stopped = fieldOf(toJson((await bay([...call, "--json"])).json), "run") ?? null;
    const waiting = fieldOf(stopped, "waiting") ?? null;
    assert.equal(textField(waiting, "reason"), "approval");
    const command = commandLike(coordinator, / approve (?!--trust)(?!.*--choice)/);
    const approved = await ranAsWritten(command, {
      "<runId>": textField(stopped, "id") ?? "",
      "<stepKey>": textField(waiting, "stepKey") ?? "",
      "<hash>": textField(waiting, "hash") ?? "",
      "<the owner's exact words>": "Yes, keep it",
    });
    assert.equal(approved.exitCode, 0, approved.output);
    assert.equal(textField(fieldOf(toJson(approved.json), "run") ?? null, "status"), "done");
  });
});

test("the coordinator's command for an approval with choices, filled with the choice the owner named, takes it", async () => {
  await withBuiltProject(async (project, coordinator) => {
    const call = [
      "call",
      "--workflow",
      "shipper:workflows/ship.yaml",
      '{"version":"1.2.0"}',
      "--project",
      project.root,
    ];
    const stopped = fieldOf(toJson((await bay([...call, "--json"])).json), "run") ?? null;
    const waiting = fieldOf(stopped, "waiting") ?? null;
    assert.equal(textField(waiting, "reason"), "approval");
    assert.ok(fieldOf(waiting, "choices") !== undefined);
    const command = commandLike(coordinator, / approve (?!--trust).*--choice /);
    const taken = await ranAsWritten(command, {
      "<runId>": textField(stopped, "id") ?? "",
      "<stepKey>": textField(waiting, "stepKey") ?? "",
      "<name>": "hold",
      "<hash>": textField(waiting, "hash") ?? "",
      "<the owner's exact words>": "Hold it, please",
    });
    assert.equal(taken.exitCode, 0, taken.output);
    const run = fieldOf(toJson(taken.json), "run") ?? null;
    assert.equal(textField(run, "status"), "done");
    assert.deepEqual(fieldOf(run, "output"), { taken: "hold" });
  });
});

test("the coordinator's two commands for trust, filled from the mode and the card's hash, give trust", async () => {
  await withBuiltProject(async (_project, coordinator) => {
    const asking = commandLike(coordinator, / approve --trust <mode> --json/);
    const answering = commandLike(coordinator, / approve --trust <mode> --hash /);
    const asked = await ranAsWritten(asking, { "<mode>": goToolchain });
    assert.equal(asked.exitCode, 1, asked.output);
    const hash = textField(toJson(asked.json), "hash") ?? "";
    assert.match(hash, /^[0-9a-f]{64}$/);
    const answered = await ranAsWritten(answering, {
      "<mode>": goToolchain,
      "<full hash>": hash,
      "<the owner's exact words>": `Yes, trust ${goToolchain}`,
    });
    assert.equal(answered.exitCode, 0, answered.output);
    assert.equal(textField(toJson(answered.json), "trusted"), goToolchain);
  });
});
