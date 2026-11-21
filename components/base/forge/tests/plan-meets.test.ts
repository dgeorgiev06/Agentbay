import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { designFiles } from "../scripts/lib/design-files.ts";
import { designOf } from "../scripts/lib/design-form.ts";
import { bay, kitTemplate, listOf, project, removeAll, runOf, textAt } from "./kit-copy.ts";
import { todoDesign, todoHides } from "./todo-design.ts";
import { designFile, requirementsFile, tdOne, tdTwo, todoDesignFiles, todoPlan, writtenIn } from "./todo-plan.ts";

const schemas = "docs/designs/todo/schemas/todo";

const checks = { id: "DOD-X-1", says: "The kit's checks pass.", level: "must", proof: { kind: "checks" } };

const oldKinds = [
  "after names no slice",
  "cycle",
  "scopes share a path",
  "scopes may share a path",
  "whole feature",
  "one after another",
];

let template: string;

let root: string;

before(async () => {
  template = await kitTemplate();
  root = await project(template);
  await writtenIn(root, todoDesignFiles());
  const archive = {
    ...fieldsOf(todoDesign),
    modules: [
      ...listOf(fieldsOf(todoDesign).modules),
      { name: "archive", hides: todoHides, implements: [], owns: { files: ["components/modes/todo/archive.json"] } },
    ],
  };
  const files = designFiles({ job: "archived", file: requirementsFile, version: 1, design: designOf(archive) });
  await writtenIn(root, files);
});

after(async () => {
  await removeAll();
});

function slice(planned: Json, changes: Readonly<Record<string, Json>>): Json {
  return { ...fieldsOf(planned), ...changes };
}

function sliceFields(planned: Json, changes: Readonly<Record<string, Json>>): Json {
  const fields = fieldsOf(planned);
  return { ...fields, slice: { ...fieldsOf(fields.slice ?? null), ...changes } };
}

function cutFrom(slices: readonly Json[], design = designFile): Json {
  return { ...fieldsOf(todoPlan), requirements: requirementsFile, design, slices: [...slices] };
}

async function waves(name: string, plan: Json): Promise<Json> {
  const file = `docs/plans/${name}.yaml`;
  await mkdir(join(root, "docs/plans"), { recursive: true });
  await writeFile(join(root, file), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return wavesOf(file);
}

async function wavesOf(file: string): Promise<Json> {
  const run = fieldsOf(runOf(await bay(root, ["call", "forge.waves", JSON.stringify({ plan: file })])));
  assert.equal(run.status, "done", JSON.stringify(run));
  return run.output ?? null;
}

async function problemsOf(name: string, plan: Json): Promise<readonly Json[]> {
  return listOf(fieldsOf(await waves(name, plan)).problems);
}

describe("forge.waves on a plan cut from a design", { concurrency: true }, () => {
  test("the todo plan cut from the todo design meets every condition, names its interface files, and has no problem", async () => {
    const output = fieldsOf(await waves("todo", cutFrom([tdOne, tdTwo])));
    assert.deepEqual(output.problems, []);
    assert.deepEqual(output.waves, [
      { wave: 1, slices: ["TD1"], builders: 1 },
      { wave: 2, slices: ["TD2"], builders: 1 },
    ]);
    const [first = null] = listOf(output.slices);
    assert.deepEqual(fieldsOf(first).meets, fieldsOf(tdOne).meets);
    assert.deepEqual(fieldsOf(first).interface, fieldsOf(tdOne).interface);
  });

  test("a condition no slice meets, and a slice that meets a condition the requirements do not hold", async () => {
    const short = slice(tdTwo, { meets: ["O2-C1", "O2-C2", "O2-C3", "O2-C5", "O2-C6", "O9-C1"] });
    assert.deepEqual(await problemsOf("unmet", cutFrom([tdOne, short])), [
      {
        kind: "condition not met",
        level: "error",
        condition: "O2-C4",
        sentence:
          "No slice meets the condition O2-C4 of docs/requirements/todo.yaml. Name it in meets of the slice " +
          "that makes it true, or add a slice for it.",
      },
      {
        kind: "condition not held",
        level: "error",
        slice: "TD2",
        condition: "O9-C1",
        sentence:
          "TD2 meets O9-C1, which docs/requirements/todo.yaml does not hold. Name in meets only conditions the " +
          "requirements hold.",
      },
    ]);
  });

  test("a slice that names no interface file, and one that names a file the design did not commit", async () => {
    const none = slice(tdOne, { interface: [] });
    const stray = slice(tdTwo, { interface: [`${schemas}/done-request.json`, `${schemas}/edit-request.json`] });
    const problems = await problemsOf("interface", cutFrom([none, stray]));
    assert.deepEqual(problems.filter((problem) => fieldsOf(problem).kind !== "no request file").length, 2);
    assert.deepEqual(
      problems.filter((problem) => fieldsOf(problem).kind !== "no request file"),
      [
        {
          kind: "no interface",
          level: "error",
          slice: "TD1",
          sentence:
            "TD1 names no interface file. Name in interface the files of docs/designs/todo/design.yaml it builds " +
            "against, so that its tests and its code meet there.",
        },
        {
          kind: "interface not in the design",
          level: "error",
          slice: "TD2",
          file: `${schemas}/edit-request.json`,
          sentence:
            `TD2 names the interface file ${schemas}/edit-request.json, which the design ` +
            "docs/designs/todo/design.yaml did not commit. Name only the design file and the schema files it committed.",
        },
      ],
    );
  });

  test("a slice that reaches two modules of the design without a reason, and one that gives it", async () => {
    const design = "docs/designs/archived/design.yaml";
    const archived = (planned: Json): Json => {
      const named = listOf(fieldsOf(planned).interface).map((file) =>
        typeof file === "string" ? file.replace("/todo/schemas", "/archived/schemas") : "",
      );
      return slice(planned, { interface: named });
    };
    const because = { crossesModulesBecause: "The archive file is written by the same actions." };
    assert.deepEqual(
      await problemsOf("crossing", cutFrom([archived(tdOne), archived(slice(tdTwo, because))], design)),
      [
        {
          kind: "crosses modules",
          level: "error",
          slice: "TD1",
          modules: ["todo", "archive"],
          sentence:
            "TD1 reaches the modules todo and archive of the design. Keep the slice to one module, or say in " +
            "crossesModulesBecause why it must reach them all.",
        },
      ],
    );
  });

  test("a slice of kind mode that meets no condition is not vertical; one of kind interface may meet none", async () => {
    const shared = sliceFields(slice(tdOne, { meets: [] }), {
      name: "TD0",
      kind: "interface",
      scope: ["components/base/interfaces/todo/**"],
      done: [checks],
    });
    const empty = slice(tdOne, { meets: [] });
    const kinds = (await problemsOf("vertical", cutFrom([shared, empty, tdTwo]))).map(
      (problem) => fieldsOf(problem).kind ?? null,
    );
    assert.deepEqual(
      kinds.filter((kind) => kind !== "condition not met"),
      ["not vertical"],
    );
    const [notVertical] = (await problemsOf("vertical-2", cutFrom([empty, tdTwo]))).filter(
      (problem) => fieldsOf(problem).kind === "not vertical",
    );
    assert.deepEqual(notVertical, {
      kind: "not vertical",
      level: "error",
      slice: "TD1",
      sentence:
        "TD1 meets no condition and is of kind mode, so nobody could see it working on its own. Name in meets " +
        "the conditions it makes true, or make it a slice of kind interface or capability.",
    });
  });

  test("a slice that changes a fixed file of a slice it does not come after, before it or beside it", async () => {
    const early = sliceFields(tdOne, {
      scope: ["components/modes/todo/**", "components/modes/todo/tests/done-remove.test.ts"],
    });
    const beside = sliceFields(slice(tdOne, { meets: [] }), {
      name: "TD3",
      kind: "capability",
      scope: [`${schemas}/add-request.json`],
      done: [checks],
    });
    const problems = await problemsOf("fixed", cutFrom([early, tdTwo, beside]));
    assert.deepEqual(
      problems.filter((problem) => fieldsOf(problem).kind === "fixed file changed"),
      [
        {
          kind: "fixed file changed",
          level: "error",
          slice: "TD1",
          owner: "TD2",
          file: "components/modes/todo/tests/done-remove.test.ts",
          sentence:
            "TD1 changes components/modes/todo/tests/done-remove.test.ts, a test it names of TD2, before TD2 " +
            "comes. Take components/modes/todo/tests/done-remove.test.ts out of TD1, or change it in a slice after TD2.",
        },
        {
          kind: "fixed file changed",
          level: "error",
          slice: "TD3",
          owner: "TD1",
          file: `${schemas}/add-request.json`,
          sentence:
            `TD3 changes ${schemas}/add-request.json, an interface file it builds against of TD1, and nothing ` +
            `orders the two. Put TD1 in the after of TD3, so that the file is made first, or take ` +
            `${schemas}/add-request.json out of TD3.`,
        },
      ],
    );
  });

  test("a slice that comes after may change a fixed file, and two slices in order may name one test file", async () => {
    const test = "components/modes/todo/tests/todo.test.ts";
    const extending = {
      id: "DOD-TD2-3",
      says: "It adds to the todo test.",
      level: "must",
      proof: { kind: "fails-first", tests: [test] },
    };
    const done = [...listOf(fieldsOf(fieldsOf(tdTwo).slice ?? null).done), extending];
    const later = sliceFields(tdTwo, {
      scope: ["components/modes/todo/**", test, `${schemas}/add-request.json`],
      done,
    });
    assert.deepEqual(await problemsOf("fixed-after", cutFrom([tdOne, later])), []);
  });

  test("requirements that are not accepted, and a design that cannot be read, are problems with their sentence", async () => {
    const plan = {
      ...fieldsOf(cutFrom([tdOne, tdTwo])),
      requirements: "docs/requirements/none.yaml",
      design: "docs/designs/none/design.yaml",
    };
    const problems = await problemsOf("sources", plan);
    assert.deepEqual(
      problems.map((problem) => [fieldsOf(problem).kind ?? null, fieldsOf(problem).file ?? null]),
      [
        ["requirements not accepted", "docs/requirements/none.yaml"],
        ["design not read", "docs/designs/none/design.yaml"],
      ],
    );
    assert.match(
      textAt(problems[1] ?? null, "sentence"),
      /^The plan names the design docs\/designs\/none\/design.yaml, which forge could not read: /,
    );
  });

  test("plans 0022, 0023 and 0024 are worked out as they are, with no problem of the new rules", async () => {
    const [first = null, second = null, third = null] = await Promise.all(
      ["docs/plans/0022-forge-in-waves.yaml", "docs/plans/0023-todo-mode.yaml", "docs/plans/0024-forge-whole.yaml"].map(
        wavesOf,
      ),
    );
    for (const output of [first, second, third]) {
      assert.equal(fieldsOf(output).answer, "worked out");
    }
    const kinds = listOf(fieldsOf(first).problems).map((problem) => textAt(problem, "kind"));
    assert.deepEqual(
      kinds.filter((kind) => !oldKinds.includes(kind)),
      [],
    );
    assert.equal(kinds.length, 42);
    assert.deepEqual(fieldsOf(second).problems, []);
    assert.deepEqual(fieldsOf(third).problems, []);
  });
});
