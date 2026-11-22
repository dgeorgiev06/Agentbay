import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { commandLineIn, copyOfTheKit, type CommandLineIn } from "../../../../tests/test-toolbox.ts";

type Planned = {
  readonly title: string;
  readonly slice: Json;
};

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

let copy: string;

let bay: CommandLineIn;

before(async () => {
  copy = await copyOfTheKit("forge");
  bay = await commandLineIn(copy);
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

function jsonOf(text: string): Json {
  const read = readYaml(text);
  assert.ok(read.ok, text);
  return read.value;
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function listOf(value: Json | undefined): readonly Json[] {
  return isList(value) ? value : [];
}

type Printed = { readonly output: string };

function outputOf(ran: Printed): Json {
  const run = fieldsOf(fieldsOf(jsonOf(ran.output)).run ?? null);
  assert.equal(run.status, "done", ran.output);
  return run.output ?? null;
}

function wordsFor(plan: string): readonly string[] {
  return ["call", "forge.waves", JSON.stringify({ plan }), "--json"];
}

async function called(plan: string): Promise<Json> {
  return outputOf(await bay(wordsFor(plan)));
}

function calledInAProcess(plan: string): Promise<Json> {
  const ran = spawnSync(process.execPath, ["bay/cli.ts", ...wordsFor(plan)], { cwd: copy, encoding: "utf8" });
  return Promise.resolve(outputOf({ output: ran.stdout }));
}

async function waves(name: string, plan: Json, call = called): Promise<Json> {
  const file = `docs/plans/${name}.yaml`;
  await writeFile(join(copy, file), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return call(file);
}

function planned(name: string, scope: readonly string[], afterNames: readonly string[] = []): Planned {
  const afters = afterNames.map((other) => ({ slice: other, because: `${name} reads what ${other} adds.` }));
  const done = [{ id: `DOD-${name}`, says: `${name} works.`, level: "must" }];
  return { title: `The slice ${name}`, slice: { name, kind: "mode", scope: [...scope], after: afters, done } };
}

function row(name: string, scope: readonly string[], afterNames: readonly string[] = []): Json {
  const afters = afterNames.map((other) => ({ slice: other, because: `${name} reads what ${other} adds.` }));
  return { name, title: `The slice ${name}`, kind: "mode", scope: [...scope], after: afters };
}

function plan(title: string, slices: readonly Planned[]): Json {
  return { title, slices: [...slices] };
}

function linesFrom(output: Json, heading: string): readonly Json[] {
  const lines = listOf(fieldsOf(output).lines);
  return lines.slice(lines.indexOf(heading));
}

function problemKinds(output: Json): readonly Json[] {
  return listOf(fieldsOf(output).problems).map((problem) => fieldsOf(problem).kind ?? null);
}

test("a plan of six slices in three waves: the table, the waves, the longest chain and the lines", async () => {
  const slices = [
    planned("A", ["a/**"]),
    planned("B", ["b/**"]),
    planned("C", ["c/**"], ["A"]),
    planned("D", ["d/**"], ["B"]),
    planned("E", ["e/**"], ["C"]),
    planned("F", ["f/**"], ["C", "D"]),
  ];
  assert.deepEqual(await waves("six", plan("Six slices", slices)), {
    answer: "worked out",
    title: "Six slices",
    slices: [
      row("A", ["a/**"]),
      row("B", ["b/**"]),
      row("C", ["c/**"], ["A"]),
      row("D", ["d/**"], ["B"]),
      row("E", ["e/**"], ["C"]),
      row("F", ["f/**"], ["C", "D"]),
    ],
    waves: [
      { wave: 1, slices: ["A", "B"], builders: 2 },
      { wave: 2, slices: ["C", "D"], builders: 2 },
      { wave: 3, slices: ["E", "F"], builders: 2 },
    ],
    notPlaced: [],
    longestChain: ["A", "C", "E"],
    problems: [],
    lines: [
      "Six slices",
      "6 slices in 3 waves. Longest chain, 3 slices: A, C, E.",
      "",
      "Slices",
      "A (mode) The slice A",
      "  scope: a/**",
      "  after nothing",
      "B (mode) The slice B",
      "  scope: b/**",
      "  after nothing",
      "C (mode) The slice C",
      "  scope: c/**",
      "  after A: C reads what A adds.",
      "D (mode) The slice D",
      "  scope: d/**",
      "  after B: D reads what B adds.",
      "E (mode) The slice E",
      "  scope: e/**",
      "  after C: E reads what C adds.",
      "F (mode) The slice F",
      "  scope: f/**",
      "  after C: F reads what C adds.",
      "  after D: F reads what D adds.",
      "",
      "Waves",
      "wave 1: A, B (2 builders)",
      "wave 2: C, D (2 builders)",
      "wave 3: E, F (2 builders)",
      "",
      "Problems",
      "No problems.",
    ],
  });
});

test("an after that names no slice is reported with its sentence", async () => {
  const output = await waves("unknown", plan("Unknown", [planned("A", ["a/**"]), planned("B", ["b/**"], ["Z"])]));
  assert.deepEqual(fieldsOf(output).problems, [
    {
      kind: "after names no slice",
      level: "error",
      slice: "B",
      after: "Z",
      sentence: "B comes after Z, but the plan has no slice named Z. Correct the name, or add the slice.",
    },
  ]);
  assert.deepEqual(linesFrom(output, "Waves"), [
    "Waves",
    "wave 1: A, B (2 builders)",
    "",
    "Problems",
    "error: B comes after Z, but the plan has no slice named Z. Correct the name, or add the slice.",
  ]);
});

test("a cycle is reported with the names in it, and its slices are in no wave", async () => {
  const slices = [planned("A", ["a/**"], ["B"]), planned("B", ["b/**"], ["A"]), planned("C", ["c/**"])];
  const output = await waves("cycle", plan("Cycle", slices));
  assert.deepEqual(fieldsOf(output).notPlaced, ["A", "B"]);
  assert.deepEqual(fieldsOf(output).problems, [
    {
      kind: "cycle",
      level: "error",
      slices: ["A", "B"],
      sentence: "A and B wait for each other, so none of them can start. Remove an after among them.",
    },
  ]);
  assert.deepEqual(linesFrom(output, "Cycle").slice(0, 3), [
    "Cycle",
    "3 slices in 1 wave. Longest chain, 1 slice: C.",
    "Not in any wave, since each is in a cycle or after one: A, B.",
  ]);
  assert.deepEqual(linesFrom(output, "Waves"), [
    "Waves",
    "wave 1: C (1 builder)",
    "",
    "Problems",
    "error: A and B wait for each other, so none of them can start. Remove an after among them.",
  ]);
});

test("two slices whose scopes share a path and that an after orders are in two waves, with no problem", async () => {
  const slices = [planned("A", ["bay/runs/x/**"]), planned("B", ["bay/runs/x/y.ts"], ["A"]), planned("C", ["c/**"])];
  const output = await waves("ordered", plan("Ordered", slices));
  assert.deepEqual(fieldsOf(output).waves, [
    { wave: 1, slices: ["A", "C"], builders: 2 },
    { wave: 2, slices: ["B"], builders: 1 },
  ]);
  assert.deepEqual(fieldsOf(output).problems, []);
});

test("two slices whose scopes share a path and that nothing orders: the problem names both patterns and a path", async () => {
  const slices = [planned("A", ["docs/a/**", "tests/a/**"]), planned("B", ["tests/a/b.test.ts"])];
  const output = await waves("unordered", plan("Unordered", slices));
  assert.deepEqual(fieldsOf(output).waves, [
    { wave: 1, slices: ["A"], builders: 1 },
    { wave: 2, slices: ["B"], builders: 1 },
  ]);
  assert.deepEqual(fieldsOf(output).problems, [
    {
      kind: "scopes share a path",
      level: "error",
      slices: ["A", "B"],
      patterns: ["tests/a/**", "tests/a/b.test.ts"],
      example: "tests/a/b.test.ts",
      sentence:
        "A and B could run in one wave, but both scopes admit tests/a/b.test.ts: tests/a/** in A and tests/a/b.test.ts in B. Narrow a scope, or order the two with an after.",
    },
  ]);
});

test("a scope that is a whole kernel feature is a warning that the feature may need an entry first", async () => {
  const output = await waves("feature", plan("Feature", [planned("A", ["bay/runs/**"])]));
  assert.deepEqual(linesFrom(output, "Problems"), [
    "Problems",
    "warning: A's scope admits every private file of the kernel feature runs. The feature may need an entry first, so that a slice can be given a narrower scope.",
  ]);
  assert.deepEqual(problemKinds(output), ["whole feature"]);
});

test("a plan where every slice waits for the one before is sent back, unless it says why", async () => {
  const slices = [planned("A", ["a/**"]), planned("B", ["b/**"], ["A"]), planned("C", ["c/**"], ["B"])];
  const output = await waves("in-order", plan("In order", slices));
  assert.deepEqual(linesFrom(output, "Problems"), [
    "Problems",
    "error: Every slice waits for the one before, so no two can run side by side. Say why no other order exists in oneAfterAnotherBecause, or remove an after that is not needed.",
  ]);
  const said = {
    title: "In order",
    slices: [...slices],
    oneAfterAnotherBecause: "Each slice reads the last one's file.",
  };
  assert.deepEqual(problemKinds(await waves("in-order-said", said)), []);
});

test("three problems together are all reported", async () => {
  const slices = [
    planned("A", ["a/**"], ["B"]),
    planned("B", ["b/**"], ["A"]),
    planned("C", ["c/**"], ["Y"]),
    planned("D", ["c/d.ts"]),
  ];
  const output = await waves("three", plan("Three", slices));
  assert.deepEqual(problemKinds(output), ["after names no slice", "cycle", "scopes share a path"]);
  assert.deepEqual(linesFrom(output, "Problems"), [
    "Problems",
    "error: C comes after Y, but the plan has no slice named Y. Correct the name, or add the slice.",
    "error: A and B wait for each other, so none of them can start. Remove an after among them.",
    "error: C and D could run in one wave, but both scopes admit c/d.ts: c/** in C and c/d.ts in D. Narrow a scope, or order the two with an after.",
  ]);
});

test("a plan of one slice has one wave and no problem, as a bay process works it out", async () => {
  const output = await waves("one", plan("One", [planned("A", ["a/**"])]), calledInAProcess);
  assert.deepEqual(linesFrom(output, "One"), [
    "One",
    "1 slice in 1 wave. Longest chain, 1 slice: A.",
    "",
    "Slices",
    "A (mode) The slice A",
    "  scope: a/**",
    "  after nothing",
    "",
    "Waves",
    "wave 1: A (1 builder)",
    "",
    "Problems",
    "No problems.",
  ]);
});

test("an empty plan has no waves and says so", async () => {
  assert.deepEqual(await waves("empty", plan("Empty", [])), {
    answer: "worked out",
    title: "Empty",
    slices: [],
    waves: [],
    notPlaced: [],
    longestChain: [],
    problems: [],
    lines: ["Empty", "The plan has no slices, so it has no waves."],
  });
});

test("a plan that lacks a field, has an unknown field, or a slice of an unknown kind is refused with the schema's sentence", async () => {
  const slice = planned("A", ["a/**"]);
  const unknownKind = {
    title: "A plan",
    slices: [{ title: "The slice A", slice: { ...fieldsOf(slice.slice), kind: "design" } }],
  };
  assert.deepEqual(await waves("refused", { slices: [slice], owner: "me" }), {
    answer: "refused",
    problems: [
      {
        at: "",
        sentence:
          "This file is missing the required field title. Add title. Expected: What the plan builds, in a few words the owner reads first.",
      },
      {
        at: "/owner",
        sentence: "This file has the field owner, which is not allowed here. Remove owner or correct its spelling.",
      },
    ],
    lines: [
      "docs/plans/refused.yaml is not a plan forge can read, for 2 reasons:",
      "line 1: This file is missing the required field title. Add title. Expected: What the plan builds, in a few words the owner reads first.",
      "line 22: This file has the field owner, which is not allowed here. Remove owner or correct its spelling.",
    ],
  });
  assert.deepEqual(fieldsOf(await waves("kind", unknownKind)).lines, [
    "docs/plans/kind.yaml is not a plan forge can read, for 1 reason:",
    'line 8: slices.0.slice.kind must be one of "interface", "capability", "mode", but it is "design".',
  ]);
});

test("a slice with no write scope is refused with the schema's sentence", async () => {
  assert.deepEqual(fieldsOf(await waves("no-scope", plan("No scope", [planned("A", [])]))).lines, [
    "docs/plans/no-scope.yaml is not a plan forge can read, for 1 reason:",
    "line 9: slices.0.slice.scope must list at least 1 entry, but it lists fewer.",
  ]);
});

test("two slices with one name are refused, since an after names a slice by it", async () => {
  const output = await waves("twice", plan("Twice", [planned("A", ["a/**"]), planned("A", ["b/**"])]));
  assert.deepEqual(fieldsOf(output).lines, [
    "docs/plans/twice.yaml is not a plan forge can read, for 1 reason:",
    "line 25: Slices 1 and 2 are both named A. Give each slice a name of its own, since an after names a slice by it.",
  ]);
});

test("text that is not YAML is refused with the line the reader names", async () => {
  await writeFile(join(copy, "docs/plans/broken.yaml"), "title: [a\nslices: []\n", "utf8");
  assert.deepEqual(fieldsOf(await called("docs/plans/broken.yaml")).lines, [
    "docs/plans/broken.yaml is not a plan forge can read, for 1 reason:",
    "line 2: The YAML cannot be read: Flow sequence in block collection must be sufficiently indented and end with a ]. Correct the YAML syntax at this line.",
  ]);
});

test("the plan's slice is proof@1's slice by reference, so a slice proof@1 refuses is refused here too", async () => {
  const schema = readYaml(await readFile(join(kit, "components/base/forge/schemas/plan.json"), "utf8"));
  assert.ok(schema.ok);
  const plannedSlice = fieldsOf(
    fieldsOf(fieldsOf(fieldsOf(schema.value).$defs ?? null).plannedSlice ?? null).properties ?? null,
  );
  assert.deepEqual(plannedSlice.slice, { $ref: "proof@1/prove-request.json#/$defs/slice" });
  const request = jsonOf(await readFile(join(kit, "components/base/interfaces/proof/tests/tr2.json"), "utf8"));
  const tr2 = fieldsOf(request).slice ?? null;
  const accepted = await waves("tr2", {
    title: "TR2",
    slices: [{ title: "The broker reads the record again", slice: tr2 }],
  });
  assert.equal(fieldsOf(accepted).answer, "worked out");
  const withId = { ...fieldsOf(tr2), id: "TR2" };
  const refused = await waves("tr2-id", { title: "TR2", slices: [{ title: "The broker", slice: withId }] });
  assert.deepEqual(fieldsOf(refused).problems, [
    {
      at: "/slices/0/slice/id",
      sentence: "slices.0.slice has the field id, which is not allowed here. Remove id or correct its spelling.",
    },
  ]);
});

test("plan 0022 as a file is read, and worked out", async () => {
  assert.equal(fieldsOf(await called("docs/plans/0022-forge-in-waves.yaml")).answer, "worked out");
});
