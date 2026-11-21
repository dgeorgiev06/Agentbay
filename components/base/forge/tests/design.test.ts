import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { designCard } from "../scripts/lib/design-card.ts";
import { designOf } from "../scripts/lib/design-form.ts";
import { listOf } from "../scripts/lib/json-values.ts";
import { pathCard } from "../scripts/lib/path-card.ts";
import { requirementsOf, type Requirements } from "../scripts/lib/requirements-form.ts";
import {
  assertTheMainCheckoutIsUntouched,
  bay,
  branches,
  decided,
  git,
  into,
  kitTemplate,
  playedTo,
  printedCard,
  project,
  removeAll,
  runOf,
  shown,
  textAt,
  waitingOf,
  worktrees,
  type Waiting,
} from "./kit-copy.ts";
import { printed } from "./printed-card.ts";
import { todoDesign } from "./todo-design.ts";

const file = "docs/requirements/todo.yaml";

const because = "It serves every condition with four actions on one table.";

const skills = {
  designs: "forge skills/design, tier deep",
  challenge: "forge skills/challenge, tier deep",
};

const schemaFiles = ["add", "list", "done", "remove"].flatMap((action) =>
  ["request", "response"].map((side) => `docs/designs/todo/schemas/todo/${action}-${side}.json`),
);

let template: string;

before(async () => {
  template = await kitTemplate();
});

after(async () => {
  await removeAll();
});

async function requirementsIn(root: string): Promise<Requirements> {
  const read = readYaml(await readFile(join(root, file), "utf8"));
  assert.ok(read.ok);
  return requirementsOf(read.value);
}

async function startedDesign(root: string): Promise<Json> {
  return runOf(await bay(root, ["call", "--workflow", "forge:workflows/design.yaml", JSON.stringify({ file })]));
}

function allHeld(task: Json): Json {
  const practices = listOf(fieldsOf(fieldsOf(task).input ?? null).practices);
  const answers = practices.map((practice) => ({ id: textAt(practice, "id"), answer: "held", sentence: "It holds." }));
  return { chosen: "first", because, practices: answers };
}

function choiceRows(names: readonly (readonly [string, string])[]): readonly { name: string; does: string }[] {
  return names.map(([name, does]) => ({ name, does }));
}

describe("the workflow design, from docs/requirements/todo.yaml", { concurrency: true }, () => {
  test("the light path shows the first card and the design card as printed, and approve commits design.yaml and the schema files", async () => {
    const root = await project(template);
    const requirements = await requirementsIn(root);
    const start = waitingOf(await startedDesign(root), "path");
    const pathChoices = choiceRows([
      ["light", "One designer, then a challenger"],
      ["full", "Two designers apart, then a comparison"],
      ["stop", "Stop; nothing is designed"],
    ]);
    assert.deepEqual(
      await printedCard(root, start.id, "Which path"),
      printed(pathCard(file, requirements), pathChoices).split("\n"),
    );
    await decided(root, start, { step: "path", choice: "light" });
    const designerTasks: Json[] = [];
    const challengerTasks: Json[] = [];
    await playedTo(root, start.id, {
      designer: (task) => {
        designerTasks.push(task);
        return Promise.resolve(todoDesign);
      },
      challenger: (task) => {
        challengerTasks.push(task);
        return Promise.resolve(allHeld(task));
      },
    });
    assert.equal(designerTasks.length, 1);
    assert.equal(challengerTasks.length, 1);
    const answered = allHeld(challengerTasks[0] ?? null);
    const card: Waiting = waitingOf(await shown(root, start.id), "card");
    const expected = designCard({
      file,
      requirements,
      path: "light",
      chosen: "first",
      because,
      design: designOf(todoDesign),
      problems: [],
      refusedSchemas: 0,
      practices: listOf(fieldsOf(answered).practices).map((practice) => ({
        id: textAt(practice, "id"),
        answer: "held",
        sentence: "It holds.",
      })),
      differences: [],
    });
    const cardChoices = choiceRows([
      ["approve", "Commit the design and its schema files"],
      ["stop", "Stop; nothing is committed"],
    ]);
    assert.deepEqual(
      await printedCard(root, start.id, "Commit the design"),
      printed(expected.card, cardChoices, { skills }).split("\n"),
    );
    const done = runOf(await decided(root, card, { step: "card", choice: "approve" }));
    assert.equal(textAt(done, "status"), "done", JSON.stringify(done));
    const output = fieldsOf(fieldsOf(done).output ?? null);
    const interfaceFiles = ["docs/designs/todo/design.yaml", ...schemaFiles];
    assert.deepEqual(
      { design: output.design, interface: output.interface, into: output.into },
      { design: "docs/designs/todo/design.yaml", interface: interfaceFiles, into },
    );
    const commit = textAt(output, "commit");
    const committed = git(root, ["show", "--name-only", "--format=", commit])
      .split("\n")
      .filter((line) => line !== "");
    assert.deepEqual(committed.sort(), [...interfaceFiles].sort());
    assert.equal(git(root, ["merge-base", "--is-ancestor", commit, into]), "");
    assert.equal(textAt(output, "merged"), git(root, ["rev-parse", into]).trim());
    const added = git(root, ["show", `${into}:docs/designs/todo/schemas/todo/add-request.json`]);
    const [todo] = designOf(todoDesign).interfaces;
    assert.deepEqual(JSON.parse(added), todo?.actions[0]?.request);
    const kept = readYaml(git(root, ["show", `${into}:docs/designs/todo/design.yaml`]));
    assert.ok(kept.ok);
    assert.deepEqual(fieldsOf(kept.value).requirements, { file, version: 1 });
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(branches(root), []);
    assertTheMainCheckoutIsUntouched(root);
    const second = waitingOf(await startedDesign(root), "path");
    await decided(root, second, { step: "path", choice: "light" });
    await playedTo(root, second.id, {
      designer: () => Promise.resolve(todoDesign),
      challenger: (task) => Promise.resolve(allHeld(task)),
    });
    const secondCard = waitingOf(await shown(root, second.id), "card");
    const again = runOf(await decided(root, secondCard, { step: "card", choice: "approve" }));
    assert.equal(textAt(again, "status"), "done", JSON.stringify(again));
    assert.equal(textAt(fieldsOf(again).output ?? null, "merged"), git(root, ["rev-parse", into]).trim());
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(branches(root), []);
  });

  test("a refused requirements file stops the run with every problem and its line, and nothing is designed", async () => {
    const root = await project(template);
    const text = await readFile(join(root, file), "utf8");
    await writeFile(join(root, file), text.replace("        then: 0 todos are listed\n", ""), "utf8");
    const run = await startedDesign(root);
    assert.equal(textAt(run, "status"), "failed", JSON.stringify(run));
    assert.equal(
      textAt(run, "reason"),
      `requirements.check refused ${file} for 1 problem, so no design is written; correct each and run the design ` +
        "again: line 27: O1-C3: outcomes.0.conditions.2 is missing the required field then. Add then.",
    );
    assert.deepEqual(worktrees(root), []);
  });

  test("a design that serves no action for a condition goes back to its designer with the problem, and the run stops with it", async () => {
    const root = await project(template);
    const start = waitingOf(await startedDesign(root), "path");
    await decided(root, start, { step: "path", choice: "light" });
    const [todo = null] = listOf(fieldsOf(todoDesign).interfaces);
    const [add = null, ...others] = listOf(fieldsOf(todo).actions);
    const short = { ...fieldsOf(add), serves: ["O1-C1", "O1-C4", "O1-C5", "O1-C6", "O1-C7"] };
    const broken = { ...fieldsOf(todoDesign), interfaces: [{ ...fieldsOf(todo), actions: [short, ...others] }] };
    const feedback: Json[] = [];
    await playedTo(root, start.id, {
      designer: (task) => {
        feedback.push(fieldsOf(task).feedback ?? null);
        return Promise.resolve(broken);
      },
    });
    const sentence = `The condition O2-C4 of ${file} is served by no action; name it in serves of the action a person uses for it.`;
    assert.deepEqual(feedback.slice(1), [[sentence], [sentence]]);
    const run = await shown(root, start.id);
    assert.equal(textAt(run, "status"), "failed", JSON.stringify(run));
    assert.match(textAt(run, "reason"), /failed its checks in round 3, the last round: The condition O2-C4/);
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(branches(root), []);
  });

  test("a design whose worked example breaks its action's schema goes back to its designer with the sentence", async () => {
    const root = await project(template);
    const start = waitingOf(await startedDesign(root), "path");
    await decided(root, start, { step: "path", choice: "light" });
    const [todo = null] = listOf(fieldsOf(todoDesign).interfaces);
    const [add = null, ...others] = listOf(fieldsOf(todo).actions);
    const [first = null, ...rest] = listOf(fieldsOf(add).examples);
    const wrong = { ...fieldsOf(first), answer: { id: 0, text: "buy milk", status: "open" } };
    const changed = { ...fieldsOf(add), examples: [wrong, ...rest] };
    const broken = { ...fieldsOf(todoDesign), interfaces: [{ ...fieldsOf(todo), actions: [changed, ...others] }] };
    const feedback: Json[] = [];
    await playedTo(root, start.id, {
      designer: (task) => {
        feedback.push(fieldsOf(task).feedback ?? null);
        return Promise.resolve(broken);
      },
    });
    const sentence =
      'The answer of example 1 of "todo.add" does not fit the response schema of "todo.add". At /id: id must be at ' +
      "least 1, but it is 0.";
    assert.deepEqual(feedback.slice(1), [[sentence], [sentence]]);
    const run = await shown(root, start.id);
    assert.equal(textAt(run, "status"), "failed", JSON.stringify(run));
    assert.match(textAt(run, "reason"), /failed its checks in round 3, the last round: The answer of example 1/);
    assert.deepEqual(worktrees(root), []);
  });
});
