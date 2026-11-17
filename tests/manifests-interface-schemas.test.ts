import assert from "node:assert/strict";
import { test } from "node:test";
import type { Interface } from "../bay/generated/interface.ts";
import type { Mode } from "../bay/generated/mode.ts";
import { inspectSystem, loadSystem, type InspectedFolder, type System } from "../bay/manifests/manifests.ts";
import type { Problem } from "../bay/outcome.ts";
import { fakeFileSystem } from "./fakes.ts";
import { layout, rooted, yamlText } from "./system-fixture.ts";

const greeterFile = "components/modes/greeter/mode.yaml";

const greetingFile = "components/base/interfaces/greeting.yaml";

const greeting: Interface = {
  name: "greeting",
  version: 1,
  actions: {
    greet: { input: "greeting/greet-input.json", output: "greeting/greet-output.json", effects: ["read"] },
  },
};

const farewell: Interface = {
  name: "farewell",
  version: 1,
  actions: {
    part: { input: "farewell/part-input.json", output: "farewell/part-output.json", effects: [] },
  },
};

const greetInput = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: { name: { type: "string" } },
};

const greetOutput = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string" } },
};

const partInput = { type: "object", required: ["until"], properties: { until: { type: "string" } } };

const partOutput = { type: "object", required: ["said"], properties: { said: { type: "boolean" } } };

const waveInput = { type: "object", required: ["times"], properties: { times: { type: "integer" } } };

const waveOutput = { type: "object", required: ["waved"], properties: { waved: { type: "integer" } } };

const greet = {
  description: "When someone is to be greeted.",
  effects: ["read"],
  run: [{ script: "scripts/greet.ts" }],
};

const part = { description: "When someone leaves.", effects: [], run: [{ script: "scripts/part.ts" }] };

const wave = {
  description: "When someone is to be waved at.",
  input: "schemas/wave-input.json",
  output: "schemas/wave-output.json",
  effects: ["read"],
  run: [{ script: "scripts/wave.ts" }],
};

const greeter = {
  name: "greeter",
  version: "1.0.0",
  description: "Greets, parts and waves.",
  implements: ["greeting@1", "farewell@1"],
  actions: { greet, part, wave },
};

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function kitFiles(): Record<string, string> {
  return {
    [greetingFile]: yamlText(greeting),
    "components/base/interfaces/greeting/greet-input.json": json(greetInput),
    "components/base/interfaces/greeting/greet-output.json": json(greetOutput),
    "components/base/interfaces/farewell.yaml": yamlText(farewell),
    "components/base/interfaces/farewell/part-input.json": json(partInput),
    "components/base/interfaces/farewell/part-output.json": json(partOutput),
    [greeterFile]: yamlText(greeter),
    "components/modes/greeter/schemas/wave-input.json": json(waveInput),
    "components/modes/greeter/schemas/wave-output.json": json(waveOutput),
    "components/modes/greeter/scripts/greet.ts": "",
    "components/modes/greeter/scripts/part.ts": "",
    "components/modes/greeter/scripts/wave.ts": "",
    "agentbay.config.yaml": yamlText({ bindings: {}, adapter: "local", modes: ["greeter"] }),
  };
}

function withGreeter(changes: Partial<Mode> | Readonly<Record<string, unknown>>): Record<string, string> {
  return { ...kitFiles(), [greeterFile]: yamlText({ ...greeter, ...changes }) };
}

async function systemOf(files: Readonly<Record<string, string>>): Promise<System> {
  const outcome = await loadSystem(fakeFileSystem(rooted(files)), layout);
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  return outcome.value;
}

async function problemsOf(files: Readonly<Record<string, string>>): Promise<readonly Problem[]> {
  const outcome = await loadSystem(fakeFileSystem(rooted(files)), layout);
  assert.ok(!outcome.ok, "expected the system to be refused");
  return outcome.problems;
}

async function greeterFolder(
  files: Readonly<Record<string, string>>,
): Promise<Extract<InspectedFolder, { readonly manifest: object }>> {
  const inspection = await inspectSystem(fakeFileSystem(rooted(files)), layout);
  const found = inspection.folders.find((entry) => entry.folder === "/kit/components/modes/greeter");
  assert.ok(found?.manifest !== undefined, "greeter was not read");
  return found;
}

test("an action that its interface names has the interface's input and output, and checks values with them", async () => {
  const system = await systemOf(kitFiles());
  const target = system.action("greeter.greet");
  assert.ok(target.ok, JSON.stringify(target));
  const { input, output, action } = target.value;
  assert.equal(input.file, "/kit/components/base/interfaces/greeting/greet-input.json");
  assert.equal(output.file, "/kit/components/base/interfaces/greeting/greet-output.json");
  assert.deepEqual(input.json, greetInput);
  assert.deepEqual(output.json, greetOutput);
  assert.equal(action.input, "../../base/interfaces/greeting/greet-input.json");
  assert.equal(action.output, "../../base/interfaces/greeting/greet-output.json");
  assert.deepEqual(input.check({ name: "Ada" }), { ok: true, value: { name: "Ada" } });
  assert.deepEqual(input.check({}), {
    ok: false,
    problems: [
      {
        file: "/kit/components/base/interfaces/greeting/greet-input.json",
        path: "/input",
        message: "input is missing the required field name.",
        fix: "Add name.",
      },
    ],
  });
  assert.deepEqual(output.check({ text: "Hello, Ada." }), { ok: true, value: { text: "Hello, Ada." } });
  assert.equal(output.check({ text: 3 }).ok, false);
});

test("bay actions lists an action that its interface names with the interface's input", async () => {
  const system = await systemOf(kitFiles());
  assert.deepEqual(system.listing({ mode: "greeter", find: "greeted" }), {
    ok: true,
    value: {
      mode: "greeter",
      actions: [
        { name: "greeter.greet", description: "When someone is to be greeted.", effects: ["read"], input: greetInput },
      ],
    },
  });
});

test("an action that no interface names keeps its own input and output", async () => {
  const system = await systemOf(kitFiles());
  const target = system.action("greeter.wave");
  assert.ok(target.ok, JSON.stringify(target));
  assert.equal(target.value.input.file, "/kit/components/modes/greeter/schemas/wave-input.json");
  assert.deepEqual(target.value.input.json, waveInput);
  assert.deepEqual(target.value.output.json, waveOutput);
  assert.equal(target.value.action.input, "schemas/wave-input.json");
  assert.equal(target.value.action.output, "schemas/wave-output.json");
});

test("a mode that implements two interfaces takes each action's schemas from the interface that names it", async () => {
  const system = await systemOf(kitFiles());
  const greetTarget = system.action("greeter.greet");
  const partTarget = system.action("greeter.part");
  assert.ok(greetTarget.ok && partTarget.ok);
  assert.deepEqual(greetTarget.value.output.json, greetOutput);
  assert.equal(partTarget.value.input.file, "/kit/components/base/interfaces/farewell/part-input.json");
  assert.deepEqual(partTarget.value.input.json, partInput);
  assert.deepEqual(partTarget.value.output.json, partOutput);
});

test("an action that no interface names and gives no input is an error with a fix", async () => {
  const waveWithoutInput = { description: wave.description, output: wave.output, effects: wave.effects, run: wave.run };
  const problems = await problemsOf(withGreeter({ actions: { greet, part, wave: waveWithoutInput } }));
  assert.deepEqual(problems, [
    {
      file: greeterFile,
      path: "/actions/wave",
      line: 20,
      message:
        "Action wave of mode greeter gives no input schema, and no interface that greeter implements names wave.",
      fix: "Add input: with the JSON Schema file of the input of wave.",
    },
  ]);
});

test("two interfaces of a mode that name the same action are an error with a fix", async () => {
  const alsoGreet = {
    input: "farewell/part-input.json",
    output: "farewell/part-output.json",
    effects: ["read"] as const,
  };
  const twice: Interface = { ...farewell, actions: { ...farewell.actions, greet: alsoGreet } };
  const problems = await problemsOf({ ...kitFiles(), "components/base/interfaces/farewell.yaml": yamlText(twice) });
  assert.deepEqual(problems, [
    {
      file: greeterFile,
      path: "/actions/greet",
      line: 9,
      message:
        "Action greet of mode greeter is named by more than one interface that it implements: greeting@1, farewell@1.",
      fix: "Keep only one of greeting@1, farewell@1 in the implements of greeter, or rename greet in all but one of them.",
    },
  ]);
});

test("an interface file without its schema is reported once, at the interface", async () => {
  const files = { ...kitFiles() };
  delete files["components/base/interfaces/greeting/greet-input.json"];
  const problems = await problemsOf(files);
  assert.deepEqual(problems, [
    {
      file: greetingFile,
      path: "/actions/greet/input",
      line: 5,
      message:
        "Action greet of interface greeting@1 names the input schema greeting/greet-input.json, " +
        "but components/base/interfaces/greeting/greet-input.json does not exist.",
      fix: "Create components/base/interfaces/greeting/greet-input.json, or correct the path.",
    },
  ]);
});

test("an inspected mode checks an example of an action against the schema of the interface that names it", async () => {
  const folder = await greeterFolder(kitFiles());
  const example = "/kit/components/modes/greeter/tests/greet.example.json";
  assert.deepEqual(
    await folder.schemaProblems({ name: "Ada" }, { action: "greet", direction: "input", file: example }),
    [],
  );
  assert.deepEqual(await folder.schemaProblems({}, { action: "greet", direction: "input", file: example }), [
    { file: example, path: "/input", message: "input is missing the required field name.", fix: "Add name." },
  ]);
  assert.deepEqual(
    await folder.schemaProblems({ waved: "no" }, { action: "wave", direction: "output", file: example }),
    [{ file: example, path: "/output/waved", message: 'output.waved must be a whole number, but it is "no".' }],
  );
  assert.deepEqual(await folder.schemaProblems({}, { action: "nothing", direction: "input", file: example }), []);
});
