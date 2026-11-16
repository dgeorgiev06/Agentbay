import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { bay } from "./cli-fixture.ts";
import { kit, makeProject, type Project } from "./project-fixture.ts";

async function withProject(body: (project: Project) => Promise<void>): Promise<void> {
  const project = await makeProject();
  try {
    await body(project);
  } finally {
    await project.remove();
  }
}

const nameInput = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: { name: { type: "string" } },
};

const nameInputText = JSON.stringify(nameInput);

const greeterActions = [
  {
    name: "greeter.fetch",
    description: "When a mode needs a greeting for a name.",
    effects: ["read"],
    input: nameInput,
  },
  {
    name: "greeter.tally",
    description: "When a test spends tokens before it greets.",
    effects: ["read", "spend"],
    input: nameInput,
  },
];

test("bay actions with no mode lists each active mode with its description, as text and as JSON", async () => {
  await withProject(async (project) => {
    const text = await bay(["actions", "--project", project.root]);
    assert.equal(text.exitCode, 0, text.output);
    assert.equal(
      text.output,
      [
        "greeter  Gives a greeting for a name.",
        "writer   Drafts a note from a greeting and keeps it.",
        "bay actions <mode> lists the actions of one mode.",
      ].join("\n"),
    );
    const json = await bay(["actions", "--project", project.root, "--json"]);
    assert.equal(json.exitCode, 0);
    assert.deepEqual(json.json, {
      ok: true,
      modes: [
        { name: "greeter", description: "Gives a greeting for a name." },
        { name: "writer", description: "Drafts a note from a greeting and keeps it." },
      ],
    });
  });
});

test("bay actions with a mode lists its actions with description, effects and input schema", async () => {
  await withProject(async (project) => {
    const text = await bay(["actions", "greeter", "--project", project.root]);
    assert.equal(text.exitCode, 0, text.output);
    assert.equal(
      text.output,
      [
        "greeter.fetch",
        "  When a mode needs a greeting for a name.",
        "  effects: read",
        `  input: ${nameInputText}`,
        "greeter.tally",
        "  When a test spends tokens before it greets.",
        "  effects: read, spend",
        `  input: ${nameInputText}`,
      ].join("\n"),
    );
    const json = await bay(["actions", "greeter", "--project", project.root, "--json"]);
    assert.equal(json.exitCode, 0);
    assert.deepEqual(json.json, { ok: true, mode: "greeter", actions: greeterActions });
  });
});

test("bay actions --find keeps the modes or actions that hold every word, whatever the case", async () => {
  await withProject(async (project) => {
    const modes = await bay(["actions", "--find", "GREETING name", "--project", project.root]);
    assert.equal(
      modes.output,
      "greeter  Gives a greeting for a name.\nbay actions <mode> lists the actions of one mode.",
    );
    const modesJson = await bay(["actions", "--find", "GREETING name", "--project", project.root, "--json"]);
    assert.deepEqual(modesJson.json, {
      ok: true,
      modes: [{ name: "greeter", description: "Gives a greeting for a name." }],
    });
    const actions = await bay(["actions", "greeter", "--find", "Spends", "--project", project.root]);
    assert.equal(
      actions.output,
      [
        "greeter.tally",
        "  When a test spends tokens before it greets.",
        "  effects: read, spend",
        `  input: ${nameInputText}`,
      ].join("\n"),
    );
    const actionsJson = await bay(["actions", "greeter", "--find", "Spends", "--project", project.root, "--json"]);
    assert.deepEqual(actionsJson.json, { ok: true, mode: "greeter", actions: [greeterActions[1]] });
  });
});

test("bay actions --find with no match says so and exits 0", async () => {
  await withProject(async (project) => {
    const modes = await bay(["actions", "--find", "zebra", "--project", project.root]);
    assert.equal(modes.exitCode, 0);
    assert.equal(modes.output, "No active mode holds every word of: zebra.");
    const actions = await bay(["actions", "writer", "--find", "zebra", "--project", project.root]);
    assert.equal(actions.output, "No action of mode writer holds every word of: zebra.");
    const json = await bay(["actions", "writer", "--find", "zebra", "--project", project.root, "--json"]);
    assert.deepEqual(json.json, { ok: true, mode: "writer", actions: [] });
  });
});

test("bay actions with an unknown mode exits 1 with the sentence that names the active modes", async () => {
  await withProject(async (project) => {
    const message = "There is no active mode store. The active modes are greeter, writer.";
    const fix = "Name one of them, or leave the mode out to list them.";
    const text = await bay(["actions", "store", "--project", project.root]);
    assert.equal(text.exitCode, 1);
    assert.equal(text.output, `${message}\n  fix: ${fix}`);
    const json = await bay(["actions", "store", "--project", project.root, "--json"]);
    assert.equal(json.exitCode, 1);
    assert.deepEqual(json.json, { ok: false, problems: [{ file: "", path: "", message, fix }] });
  });
});

test("bay actions answers from the project as it is now: a mode folder added since the last call is listed", async () => {
  await withProject(async (project) => {
    const before = await bay(["actions", "--project", project.root, "--json"]);
    assert.deepEqual(before.json, {
      ok: true,
      modes: [
        { name: "greeter", description: "Gives a greeting for a name." },
        { name: "writer", description: "Drafts a note from a greeting and keeps it." },
      ],
    });
    const echo = {
      name: "echo",
      version: "0.1.0",
      description: "Says a name back.",
      actions: {
        say: {
          description: "When the owner wants a name said back.",
          input: "schemas/name.json",
          output: "schemas/name.json",
          effects: ["read"],
          run: [{ script: "scripts/say.ts" }],
        },
      },
    };
    await project.write("components/modes/echo/mode.yaml", stringify(echo));
    await project.write("components/modes/echo/schemas/name.json", `${nameInputText}\n`);
    await project.write("components/modes/echo/scripts/say.ts", "");
    const after = await bay(["actions", "--project", project.root, "--json"]);
    assert.deepEqual(after.json, {
      ok: true,
      modes: [
        { name: "echo", description: "Says a name back." },
        { name: "greeter", description: "Gives a greeting for a name." },
        { name: "writer", description: "Drafts a note from a greeting and keeps it." },
      ],
    });
  });
});

test("bay's help lists bay actions", async () => {
  const help = await bay(["--help"]);
  assert.match(help.output, /\n {2}actions +List the active modes, or the actions of one mode/);
  const own = await bay(["actions", "--help"]);
  assert.match(own.output, /^usage: bay actions \[<mode>\] \[--find <words>\]/);
});

function withoutOk(value: unknown): unknown {
  assert.ok(typeof value === "object" && value !== null && "ok" in value, JSON.stringify(value));
  const { ok, ...rest } = value;
  assert.equal(ok, true);
  return rest;
}

test("bay call --tool actions takes no token and gives the same answers as bay actions --json", async () => {
  await withProject(async (project) => {
    for (const [input, argv] of [
      ["{}", []],
      ['{"mode":"greeter"}', ["greeter"]],
      ['{"find":"GREETING name"}', ["--find", "GREETING name"]],
      ['{"mode":"greeter","find":"Spends"}', ["greeter", "--find", "Spends"]],
    ] as const) {
      const called = await bay(["call", "--tool", "actions", input, "--project", project.root, "--json"]);
      assert.equal(called.exitCode, 0, called.output);
      const listed = await bay(["actions", ...argv, "--project", project.root, "--json"]);
      assert.deepEqual(called.json, { ok: true, result: withoutOk(listed.json) });
    }
    const unknown = await bay(["call", "--tool", "actions", '{"mode":"store"}', "--project", project.root]);
    assert.equal(unknown.exitCode, 1);
    assert.equal(
      unknown.output,
      "There is no active mode store. The active modes are greeter, writer.\n" +
        "  fix: Name one of them, or leave the mode out to list them.",
    );
  });
});

test("the instructions bay build writes for Claude Code say to ask bay actions, and name no mode and no action", async () => {
  const project = await makeProject({ adapter: "claude-code" });
  try {
    const built = await bay(["build", "--project", project.root]);
    assert.equal(built.exitCode, 0, built.output);
    const instructions = (await project.read("CLAUDE.md")).replace(/\s+/g, " ");
    const bayCommand = `${kit}/bay.sh --project ${project.root}`;
    assert.ok(
      instructions.includes(
        `When you do not know which action fits what the owner asks, run \`${bayCommand} actions --json\` ` +
          `for the active modes, then \`${bayCommand} actions <mode> --json\` for that mode's actions.`,
      ),
      instructions,
    );
    const withoutPaths = instructions.replaceAll(kit, "").replaceAll(project.root, "");
    for (const name of ["greeter", "writer", "fetch", "tally", "compose"]) {
      assert.doesNotMatch(withoutPaths, new RegExp(`\\b${name}\\b`), name);
    }
  } finally {
    await project.remove();
  }
});
