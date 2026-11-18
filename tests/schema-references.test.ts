import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { checkSystem } from "../bay/check.ts";
import type { Json } from "../bay/contracts.ts";
import { loadKernel, nodeKernelPorts } from "../bay/kernel.ts";
import { layoutOf } from "../bay/layout.ts";
import { createProjectFileListing, nodeFileInspector, nodeFileSystem } from "../bay/node-ports.ts";
import { isJson } from "../bay/protocol-json.ts";
import { checkedValue } from "../bay/value-check.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { kit as theKit } from "./project-fixture.ts";

const checkAllScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const passed = [];",
  "  for (const value of input.values) {",
  "    const checked = await context.schemas.check(input.schema, value);",
  "    passed.push(checked.ok ? checked.value.passed : checked.message);",
  "  }",
  "  return passed;",
  "});",
  "",
].join("\n");

const echoScript =
  'import { defineScript } from "agentbay/sdk";\n\nexport const run = defineScript(async (input) => input);\n';

const anything = { type: ["object", "string", "number", "boolean", "array", "null"] };

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["slices"],
  properties: { slices: { type: "array", items: { $ref: "proof@1/prove-request.json#/$defs/slice" } } },
};

const wrongReferences = {
  type: "object",
  properties: {
    misspelled: { $ref: "proof@1/prove-request.json#/$defs/slise" },
    unnamed: { $ref: "proof@1/settings.json" },
    unrequired: { $ref: "worktrees@1/copy-request.json" },
    another: { $ref: "../prover/schemas/own.json" },
  },
};

const planner = {
  name: "planner",
  version: "1.0.0",
  description: "A made-up mode, planner, whose plan holds proof@1's slice by reference.",
  requires: { interfaces: ["proof@1"] },
  actions: {
    check: {
      description: "When a test asks for values checked against a schema.",
      input: "schemas/anything.json",
      output: "schemas/anything.json",
      effects: ["read"],
      run: [{ script: "scripts/check.ts" }],
    },
  },
};

const prover = {
  name: "prover",
  version: "1.0.0",
  description: "A made-up mode, prover, that implements proof@1 so that planner can be bound.",
  implements: ["proof@1"],
  actions: {
    prove: {
      description: "When a test needs proof@1 bound.",
      effects: ["read", "write", "network", "spend", "delete"],
      run: [{ script: "scripts/prove.ts" }],
    },
  },
};

const goodSlice = {
  name: "TB1",
  kind: "capability",
  scope: ["bay/sdk.ts", "tests/**"],
  after: [],
  done: [{ id: "DOD-TB1-1", says: "The checks pass.", level: "must", proof: { kind: "checks" } }],
};

const sliceCases: readonly (readonly [string, Json])[] = [
  ["a good slice", goodSlice],
  ["no name", { kind: "capability", scope: ["bay/sdk.ts"], after: [], done: goodSlice.done }],
  ["a kind that is not one", { ...goodSlice, kind: "toolbox" }],
  ["a scope with a trailing slash", { ...goodSlice, scope: ["bay/"] }],
  ["a scope that is empty", { ...goodSlice, scope: [] }],
  ["an after with no reason", { ...goodSlice, after: [{ slice: "K1" }] }],
  ["an after with its reason", { ...goodSlice, after: [{ slice: "K1", because: "it needs the grants" }] }],
  ["a field the slice does not have", { ...goodSlice, title: "The toolbox" }],
  ["an item named scope", { ...goodSlice, done: [{ ...goodSlice.done[0], id: "scope" }] }],
  ["not a mapping", ["TB1"]],
];

type Kit = { readonly root: string; readonly remove: () => Promise<void> };

function json(value: Json): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fieldOf(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

async function makeKit(plannerFiles: Readonly<Record<string, string>>): Promise<Kit> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-schema-references-")));
  const write = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, "utf8");
  };
  const interfaces = "components/base/interfaces";
  for (const file of ["proof.yaml", "proof/prove-request.json", "proof/prove-response.json", "proof/settings.json"]) {
    await write(join(interfaces, file), await readFile(join(theKit, interfaces, file), "utf8"));
  }
  await write("agentbay.config.yaml", stringify({ bindings: { proof: "prover" }, adapter: "fake" }));
  await write("components/base/prover/mode.yaml", stringify(prover));
  await write("components/base/prover/scripts/prove.ts", echoScript);
  await write("components/base/prover/schemas/own.json", json(anything));
  await write("components/base/planner/schemas/anything.json", json(anything));
  await write("components/base/planner/schemas/plan.json", json(planSchema));
  await write("components/base/planner/scripts/check.ts", checkAllScript);
  await write("components/base/planner/mode.yaml", stringify(planner));
  for (const [path, text] of Object.entries(plannerFiles)) {
    await write(join("components/base/planner", path), text);
  }
  return { root, remove: () => rm(root, { recursive: true, force: true }) };
}

async function modeChecks(kit: Kit, values: readonly Json[]): Promise<Json> {
  const kernel = await loadKernel({
    layout: layoutOf({ kit: kit.root, project: kit.root }),
    ports: nodeKernelPorts(testEnvironment),
    environment: testEnvironment,
    platform: "linux",
  });
  assert.ok(kernel.ok, JSON.stringify(kernel));
  try {
    const started = await kernel.value.runs.start({ action: "planner.check" }, { schema: "schemas/plan.json", values });
    assert.ok(started.ok, JSON.stringify(started));
    const state = started.value.state;
    assert.ok(state.status === "done", JSON.stringify(state));
    return state.output;
  } finally {
    kernel.value.close();
  }
}

async function interfaceChecks(kit: Kit, values: readonly Json[]): Promise<readonly boolean[]> {
  const file = join(kit.root, "components/base/interfaces/proof/prove-request.json");
  const request: unknown = JSON.parse(await readFile(file, "utf8"));
  const definitions = fieldOf(request, "$defs");
  assert.ok(isJson(definitions));
  const slicePart = { $defs: definitions, $ref: "#/$defs/slice" };
  return values.map(
    (value) => checkedValue("proof@1's slice", { state: "valid", schema: slicePart, parts: {} }, value).passed,
  );
}

test("a plan that holds proof@1's slice by reference accepts and refuses the slices proof@1 does", async () => {
  const kit = await makeKit({});
  try {
    const slices = sliceCases.map(([, slice]) => slice);
    const byTheMode = await modeChecks(
      kit,
      slices.map((slice) => ({ slices: [slice] })),
    );
    const byTheInterface = await interfaceChecks(kit, slices);
    const passedByTheMode: readonly Json[] = Array.isArray(byTheMode) ? byTheMode : [];
    const table = sliceCases.map(([name], index) => [name, passedByTheMode[index], byTheInterface[index]]);
    assert.deepEqual(table, [
      ["a good slice", true, true],
      ["no name", false, false],
      ["a kind that is not one", false, false],
      ["a scope with a trailing slash", false, false],
      ["a scope that is empty", false, false],
      ["an after with no reason", false, false],
      ["an after with its reason", true, true],
      ["a field the slice does not have", false, false],
      ["an item named scope", false, false],
      ["not a mapping", false, false],
    ]);
  } finally {
    await kit.remove();
  }
});

test("when the interface's schema changes, the mode's check follows it", async () => {
  const kit = await makeKit({});
  try {
    const file = join(kit.root, "components/base/interfaces/proof/prove-request.json");
    const toolboxSlice = { slices: [{ ...goodSlice, kind: "toolbox" }] };
    assert.deepEqual(await modeChecks(kit, [toolboxSlice]), [false]);
    const text = await readFile(file, "utf8");
    await writeFile(
      file,
      text.replace(
        '"enum": ["interface", "capability", "mode"]',
        '"enum": ["interface", "capability", "mode", "toolbox"]',
      ),
    );
    assert.deepEqual(await modeChecks(kit, [toolboxSlice]), [true]);
  } finally {
    await kit.remove();
  }
});

test("bay check says of each reference that names nothing, or names a file the mode may not, what is wrong", async () => {
  const kit = await makeKit({
    "mode.yaml": stringify({ ...planner, settings: "schemas/settings.json" }),
    "schemas/settings.json": json(wrongReferences),
  });
  try {
    const listing = createProjectFileListing(testEnvironment, nodeFileInspector);
    const report = await checkSystem(
      { files: nodeFileSystem, listing },
      layoutOf({ kit: kit.root, project: kit.root }),
    );
    const referring = report.findings.filter((finding) => finding.message.includes(" refers to "));
    const subject =
      "Mode planner names the settings schema schemas/settings.json, but components/base/planner/schemas/settings.json";
    const mayNotName = {
      fix:
        "Refer only to a part of a schema of an interface mode planner implements or requires, written " +
        "<interface>@<major>/<file>#<part>: proof@1/prove-request.json, proof@1/prove-response.json.",
    };
    assert.deepEqual(
      referring.map(({ severity, message, fix }) => ({ severity, message, fix })),
      [
        {
          severity: "error",
          message: `${subject} refers to proof@1/prove-request.json#/$defs/slise, which names nothing: proof@1/prove-request.json has no part /$defs/slise.`,
          fix: "Correct the reference to name a part of proof@1/prove-request.json, such as proof@1/prove-request.json#/$defs/<name>.",
        },
        {
          severity: "error",
          message: `${subject} refers to proof@1/settings.json, which names a file mode planner may not name.`,
          ...mayNotName,
        },
        {
          severity: "error",
          message: `${subject} refers to worktrees@1/copy-request.json, which names a file mode planner may not name.`,
          ...mayNotName,
        },
        {
          severity: "error",
          message: `${subject} refers to ../prover/schemas/own.json, which names a file mode planner may not name.`,
          ...mayNotName,
        },
      ],
    );
  } finally {
    await kit.remove();
  }
});
