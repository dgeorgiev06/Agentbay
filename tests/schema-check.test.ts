import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { loadKernel } from "../bay/kernel.ts";
import { nodeKernelPorts } from "../bay/node-ports.ts";
import { layoutOf } from "../bay/layout.ts";
import { testEnvironment } from "./kernel-fixture.ts";

const checkerScript = [
  'import { defineScript, fail } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const checked = await context.schemas.check(input.schema, input.value);",
  "  return checked.ok ? checked.value : { refused: checked.message };",
  "});",
  "",
].join("\n");

const givenScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const checked = await context.schemas.checkAgainst(input.schema, input.value);",
  "  return checked.ok ? checked.value : { refused: checked.message };",
  "});",
  "",
].join("\n");

const keeperScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => input);",
  "",
].join("\n");

const entrySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["item", "count"],
  properties: {
    item: { type: "string", minLength: 1 },
    count: { type: "integer", minimum: 0 },
  },
};

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "slices"],
  properties: {
    name: { type: "string", minLength: 1 },
    slices: { type: "array", minItems: 1, items: { type: "string" } },
  },
};

const anything = { type: ["object", "string", "number", "boolean", "array", "null"] };

const keeper = {
  name: "keeper",
  version: "1.0.0",
  description: "A made-up mode, keeper, that implements ledger@1 for a test.",
  implements: ["ledger@1"],
  actions: {
    keep: { description: "When a test keeps an entry.", effects: ["read"], run: [{ script: "scripts/keep.ts" }] },
  },
};

const ledger = {
  name: "ledger",
  version: 1,
  actions: { keep: { input: "ledger/entry.json", output: "ledger/entry.json", effects: ["read"] } },
};

type Kit = {
  readonly root: string;
  readonly write: (path: string, text: string) => Promise<void>;
  readonly remove: () => Promise<void>;
};

function json(value: Json): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const checkAction = {
  description: "When a test asks for a value checked.",
  input: "schemas/anything.json",
  output: "schemas/anything.json",
  effects: ["read"],
  run: [{ script: "scripts/check.ts" }],
};

const planner = {
  name: "planner",
  version: "1.0.0",
  description: "A made-up mode, planner, that checks values against schemas for a test.",
  requires: { interfaces: ["ledger@1"] },
  actions: {
    check: checkAction,
    "check-briefly": { ...checkAction, scriptTimeLimitSeconds: 3 },
    "check-given": { ...checkAction, run: [{ script: "scripts/check-given.ts" }] },
    "check-given-briefly": { ...checkAction, run: [{ script: "scripts/check-given.ts" }], scriptTimeLimitSeconds: 3 },
  },
};

const backtracking = { type: "string", pattern: "^(a+)+$" };

async function makeKit(): Promise<Kit> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-schema-check-")));
  const write = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, "utf8");
  };
  await write("agentbay.config.yaml", stringify({ bindings: { ledger: "keeper" }, adapter: "fake" }));
  await write("components/base/interfaces/ledger.yaml", stringify(ledger));
  await write("components/base/interfaces/ledger/entry.json", json(entrySchema));
  await write("components/base/interfaces/ledger/unnamed.json", json(entrySchema));
  await write("components/base/planner/mode.yaml", stringify(planner));
  await write("components/base/planner/schemas/anything.json", json(anything));
  await write("components/base/planner/schemas/plan.json", json(planSchema));
  await write("components/base/planner/schemas/broken.json", "{ not json\n");
  await write("components/base/planner/schemas/unusable.json", json({ type: "no-such-type" }));
  await write("components/base/planner/schemas/backtracking.json", json(backtracking));
  await write("components/base/planner/scripts/check.ts", checkerScript);
  await write("components/base/planner/scripts/check-given.ts", givenScript);
  await write("components/base/keeper/mode.yaml", stringify(keeper));
  await write("components/base/keeper/scripts/keep.ts", keeperScript);
  await write("components/base/keeper/schemas/own.json", json(planSchema));
  return { root, write, remove: () => rm(root, { recursive: true, force: true }) };
}

async function ended(kit: Kit, action: string, input: Json) {
  const kernel = await loadKernel({
    layout: layoutOf({ kit: kit.root, project: kit.root }),
    ports: nodeKernelPorts(testEnvironment),
    environment: testEnvironment,
    platform: "linux",
  });
  assert.ok(kernel.ok, JSON.stringify(kernel));
  try {
    const started = await kernel.value.runs.start({ action }, input);
    assert.ok(started.ok, JSON.stringify(started));
    return started.value.state;
  } finally {
    kernel.value.close();
  }
}

async function checked(kit: Kit, schema: string, value: Json): Promise<Json> {
  const state = await ended(kit, "planner.check", { schema, value });
  assert.ok(state.status === "done", JSON.stringify(state));
  return state.output;
}

test("a value the mode's own schema holds comes back as it was given", async () => {
  const kit = await makeKit();
  try {
    const plan = { name: "tidy", slices: ["TB1", "W1"] };
    assert.deepEqual(await checked(kit, "schemas/plan.json", plan), { passed: true, value: plan });
  } finally {
    await kit.remove();
  }
});

test("a value with three problems gets all three, in the kernel's words", async () => {
  const kit = await makeKit();
  try {
    assert.deepEqual(await checked(kit, "schemas/plan.json", { name: "", slices: [], extra: 1 }), {
      passed: false,
      problems: [
        {
          path: "/extra",
          message: "This file has the field extra, which is not allowed here.",
          fix: "Remove extra or correct its spelling.",
        },
        { path: "/name", message: "name must not be empty." },
        { path: "/slices", message: "slices must list at least 1 entry, but it lists fewer." },
      ],
    });
  } finally {
    await kit.remove();
  }
});

test("a schema of an interface the mode requires is named by the interface and its file", async () => {
  const kit = await makeKit();
  try {
    assert.deepEqual(await checked(kit, "ledger@1/entry.json", { item: "tea", count: 2 }), {
      passed: true,
      value: { item: "tea", count: 2 },
    });
    assert.deepEqual(await checked(kit, "ledger@1/entry.json", { item: "tea", count: -1 }), {
      passed: false,
      problems: [{ path: "/count", message: "count must be at least 0, but it is -1." }],
    });
  } finally {
    await kit.remove();
  }
});

test("a schema of a mode the mode has nothing to do with is refused, with the sentence", async () => {
  const kit = await makeKit();
  try {
    const declared =
      "the mode planner may name the .json files in its own folder and the schemas of the interfaces it implements or requires: ledger@1/entry.json";
    const foreign = [
      "../keeper/schemas/own.json",
      "/etc/hosts.json",
      "schemas/plan.yaml",
      "ledger@1/unnamed.json",
      "ledger@2/entry.json",
      "store@1/settings.json",
    ];
    for (const schema of foreign) {
      assert.deepEqual(await checked(kit, schema, {}), {
        refused:
          `The step 0 asked to check a value against the schema ${schema}, but ${declared}. ` +
          "Name one of those, written <file> or <interface>@<major>/<file>.",
      });
    }
  } finally {
    await kit.remove();
  }
});

test("a schema file that is missing, not JSON, or not a schema refuses the value, with the sentence", async () => {
  const kit = await makeKit();
  try {
    const refusedWith = async (schema: string): Promise<Json> =>
      checked(kit, schema, { name: "tidy", slices: ["TB1"] });
    assert.deepEqual(await refusedWith("schemas/missing.json"), {
      passed: false,
      problems: [
        { path: "", message: "The schema file schemas/missing.json does not exist, so the value is not checked." },
      ],
    });
    assert.deepEqual(await refusedWith("schemas/broken.json"), {
      passed: false,
      problems: [
        {
          path: "",
          message:
            "The schema file schemas/broken.json is not valid JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3).",
        },
      ],
    });
    assert.deepEqual(await refusedWith("schemas/unusable.json"), {
      passed: false,
      problems: [
        {
          path: "",
          message:
            "The schema file schemas/unusable.json is not a usable JSON Schema: schema is invalid: data/type must be equal to one of the allowed values, data/type must be array, data/type must match a schema in anyOf.",
        },
      ],
    });
  } finally {
    await kit.remove();
  }
});

test("a schema whose pattern backtracks without end stops only the script, at its own time limit", async () => {
  const kit = await makeKit();
  try {
    const started = performance.now();
    const state = await ended(kit, "planner.check-briefly", {
      schema: "schemas/backtracking.json",
      value: `${"a".repeat(40)}b`,
    });
    assert.deepEqual(state, {
      status: "failed",
      reason:
        "The script was stopped at its time limit of 3 seconds, set by actions.check-briefly.scriptTimeLimitSeconds " +
        `in ${join(kit.root, "components/base/planner/mode.yaml")}.`,
    });
    assert.ok(performance.now() - started < 30_000);
  } finally {
    await kit.remove();
  }
});

async function checkedGiven(kit: Kit, schema: Json, value: Json): Promise<Json> {
  const state = await ended(kit, "planner.check-given", { schema, value });
  assert.ok(state.status === "done", JSON.stringify(state));
  return state.output;
}

test("a script checks a value against a schema it gives as a value, in the kernel's words", async () => {
  const kit = await makeKit();
  try {
    const plan = { name: "tidy", slices: ["TB1", "W1"] };
    assert.deepEqual(await checkedGiven(kit, planSchema, plan), { passed: true, value: plan });
    assert.deepEqual(await checkedGiven(kit, planSchema, { name: "", slices: [] }), {
      passed: false,
      problems: [
        { path: "/name", message: "name must not be empty." },
        { path: "/slices", message: "slices must list at least 1 entry, but it lists fewer." },
      ],
    });
  } finally {
    await kit.remove();
  }
});

test("a given schema that refers to a schema file of an interface, of the mode or of the system is refused, and none is read", async () => {
  const kit = await makeKit();
  try {
    const references = [
      "ledger@1/entry.json",
      "schemas/plan.json",
      "file:///etc/hosts",
      "https://example.com/plan.json",
    ];
    for (const reference of references) {
      assert.deepEqual(await checkedGiven(kit, { $ref: reference }, { item: "tea", count: 2 }), {
        refused:
          `The schema given refers to ${reference} at /$ref, outside itself; a given schema may refer only to its ` +
          "own parts, written #/<path>, and nothing outside it is read.",
      });
    }
  } finally {
    await kit.remove();
  }
});

test("a given schema whose pattern backtracks without end stops only the script, at its own time limit, as a schema file does", async () => {
  const kit = await makeKit();
  try {
    const started = performance.now();
    const state = await ended(kit, "planner.check-given-briefly", {
      schema: backtracking,
      value: `${"a".repeat(40)}b`,
    });
    assert.deepEqual(state, {
      status: "failed",
      reason:
        "The script was stopped at its time limit of 3 seconds, set by actions.check-given-briefly.scriptTimeLimitSeconds " +
        `in ${join(kit.root, "components/base/planner/mode.yaml")}.`,
    });
    assert.ok(performance.now() - started < 30_000);
  } finally {
    await kit.remove();
  }
});
