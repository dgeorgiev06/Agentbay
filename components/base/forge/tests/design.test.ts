import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { challengeOf } from "../scripts/lib/challenge-answer.ts";
import { designCard, type DesignCardInput } from "../scripts/lib/design-card.ts";
import { designerAnswersOf, designOf } from "../scripts/lib/design-form.ts";
import { problemsByCheck } from "../scripts/lib/design-rules.ts";
import { listOf } from "../scripts/lib/json-values.ts";
import { pathCard } from "../scripts/lib/path-card.ts";
import { designPractices } from "../scripts/lib/practices.ts";
import { requirementsOf, type Requirements } from "../scripts/lib/requirements-form.ts";
import {
  answered,
  assertTheMainCheckoutIsUntouched,
  bay,
  branches,
  decided,
  factOf,
  factsOf,
  git,
  into,
  jsonOf,
  kitTemplate,
  offeredOf,
  playedTo,
  printedCard,
  processProject,
  project,
  removeAll,
  runOf,
  shown,
  task as taskOf,
  textAt,
  waitingOf,
  withheldOf,
  worktrees,
  type Asked,
  type Fact,
  type Waiting,
} from "./kit-copy.ts";
import { printed } from "./printed-card.ts";
import { todoDesign, todoHides } from "./todo-design.ts";

const file = "docs/requirements/todo.yaml";

const checksRun = problemsByCheck({ job: "todo", file, conditions: [], design: designOf(todoDesign) }).length;

const because = "It serves every condition with four actions on one table.";

const finding = {
  wrong: "No example shows the open list after a refusal, though add claims O1-C5 to O1-C7.",
  where: "todo.add",
  fix: "Add an example that lists the open todos after the refused add.",
};

const notHeldP52 = {
  id: "P-52",
  answer: "not-held",
  sentence: "The one module todo hides both the rules and the todos table, and names no pure function for the rules.",
};

const answeredHides = "How todos are kept and numbered; the rules of a todo are pure functions apart from the store.";

const practicesFiles = ["framework/practices.md", "components/base/typescript/practices.md"];

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

function p52NotHeld(task: Json, findings: readonly Json[]): Json {
  const held = fieldsOf(allHeld(task));
  const practices = listOf(held.practices).map((practice) =>
    textAt(practice, "id") === "P-52" ? notHeldP52 : practice,
  );
  return { ...held, practices, findings: [...findings] };
}

function inputOf(task: Json): Record<string, Json> {
  return fieldsOf(fieldsOf(task).input ?? null);
}

async function heldByDesign(root: string): Promise<readonly Json[]> {
  const texts = await Promise.all(practicesFiles.map((path) => readFile(join(root, path), "utf8")));
  return texts.flatMap((text) => designPractices(text)).map((practice) => ({ ...practice }));
}

function answeredDesign(): Json {
  const fields = fieldsOf(todoDesign);
  const [todo = null] = listOf(fields.interfaces);
  const [add = null, list = null, ...others] = listOf(fieldsOf(todo).actions);
  const serves = [...listOf(fieldsOf(list).serves), "O1-C5", "O1-C6", "O1-C7"];
  const [module = null] = listOf(fields.modules);
  return {
    ...fields,
    modules: [{ ...fieldsOf(module), hides: answeredHides }],
    interfaces: [{ ...fieldsOf(todo), actions: [add, { ...fieldsOf(list), serves }, ...others] }],
  };
}

const answeredChanges = [
  "module todo: what it hides is worded differently",
  "O1-C5: served by todo.add in the first, by todo.add, todo.list in the answered",
  "O1-C6: served by todo.add in the first, by todo.add, todo.list in the answered",
  "O1-C7: served by todo.add in the first, by todo.add, todo.list in the answered",
];

function assertSecondPassAsked([first = {}, , again = {}, rejudged = {}]: readonly Record<string, Json>[]): void {
  assert.deepEqual(again.answering, { design: todoDesign, practices: [notHeldP52], findings: [finding] });
  assert.equal(again.stance, first.stance);
  assert.deepEqual(again.practices, first.practices);
  assert.deepEqual(rejudged.designs, [answeredDesign()]);
  assert.deepEqual(rejudged.differences, []);
  assert.deepEqual(rejudged.answered, { practices: [notHeldP52], findings: [finding], changes: answeredChanges });
}

function actionsAsked(asked: readonly Asked[]): readonly string[] {
  return asked.map((each) => `${each.step.split("/")[0] ?? ""} ${each.action}`);
}

type ScreenFacts = {
  readonly facts: readonly Fact[];
  readonly offered: readonly string[];
  readonly withheld: Readonly<Record<string, string>>;
};

async function screenExpected(
  root: string,
  input: Omit<DesignCardInput, "file" | "requirements">,
): Promise<ScreenFacts> {
  const drawn = designCard({ file, requirements: await requirementsIn(root), ...input });
  const reason = drawn.card.withheld.approve;
  return {
    facts: drawn.card.lines.map((line) => factOf({ ...line })),
    offered: reason === undefined ? ["approve", "stop"] : ["stop"],
    withheld: reason === undefined ? {} : { approve: reason },
  };
}

function screenFacts(waiting: Waiting): ScreenFacts {
  return { facts: factsOf(waiting), offered: offeredOf(waiting), withheld: withheldOf(waiting) };
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
    const practices = await heldByDesign(root);
    assert.deepEqual(
      practices.map((practice) => textAt(practice, "id")),
      ["P-52", "P-32", "P-35"],
    );
    assert.deepEqual(inputOf(designerTasks[0] ?? null).practices, practices);
    assert.deepEqual(inputOf(challengerTasks[0] ?? null).practices, practices);
    const firstAnswer = allHeld(challengerTasks[0] ?? null);
    const card: Waiting = waitingOf(await shown(root, start.id), "card");
    const expected = await screenExpected(root, {
      path: "light",
      chosen: "first",
      because,
      design: designOf(todoDesign),
      problems: [],
      checks: checksRun,
      refusedSchemas: 0,
      practices: challengeOf(firstAnswer).practices,
      findings: [],
      said: designerAnswersOf(todoDesign),
      differences: [],
    });
    assert.deepEqual(screenFacts(card), expected);
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
    assert.equal("practices" in fieldsOf(kept.value), false);
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

  test("a practice not held and a finding send the design back to its designer once, the second challenge decides the card as printed, and approve commits the answered design", async () => {
    const root = await project(template);
    const start = waitingOf(await startedDesign(root), "path");
    await decided(root, start, { step: "path", choice: "light" });
    const asked = await playedTo(root, start.id, {
      designer: (task) => Promise.resolve(inputOf(task).answering === undefined ? todoDesign : answeredDesign()),
      challenger: (task) =>
        Promise.resolve(inputOf(task).answered === undefined ? p52NotHeld(task, [finding]) : allHeld(task)),
    });
    assert.deepEqual(actionsAsked(asked), [
      "designs design",
      "challenge challenge",
      "design-again design",
      "challenge-again challenge",
    ]);
    assertSecondPassAsked(asked.map((each) => inputOf(each.task)));
    const changes = answeredChanges;
    const expected = await screenExpected(root, {
      path: "light",
      chosen: "first",
      because,
      design: designOf(answeredDesign()),
      problems: [],
      checks: checksRun,
      refusedSchemas: 0,
      practices: challengeOf(allHeld(asked[3]?.task ?? null)).practices,
      findings: [],
      said: designerAnswersOf(answeredDesign()),
      differences: [],
      second: { notHeld: ["P-52"], findings: 1, changes },
    });
    const card = waitingOf(await shown(root, start.id), "card");
    assert.deepEqual(screenFacts(card), expected);
    const judged = listOf(fieldsOf(card.card).lines).filter((line) => textAt(line, "mark") === "judged");
    assert.deepEqual(
      [...new Set(judged.map((line) => textAt(fieldsOf(line).source ?? null, "step")))],
      ["design-again"],
    );
    const done = runOf(await decided(root, card, { step: "card", choice: "approve" }));
    assert.equal(textAt(done, "status"), "done", JSON.stringify(done));
    const committed = git(root, ["show", `${into}:docs/designs/todo/design.yaml`]);
    assert.ok(committed.includes(answeredHides));
    assert.ok(!committed.includes(todoHides));
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(branches(root), []);
  });

  test("a practice still not held after the designer's one answer leaves the card with stop only, saying the designer answered once, and no third design is asked", async () => {
    const root = await project(template);
    const start = waitingOf(await startedDesign(root), "path");
    await decided(root, start, { step: "path", choice: "light" });
    const asked = await playedTo(root, start.id, {
      designer: (task) => Promise.resolve(inputOf(task).answering === undefined ? todoDesign : answeredDesign()),
      challenger: (task) => Promise.resolve(p52NotHeld(task, inputOf(task).answered === undefined ? [] : [finding])),
    });
    assert.deepEqual(actionsAsked(asked), [
      "designs design",
      "challenge challenge",
      "design-again design",
      "challenge-again challenge",
    ]);
    const card = waitingOf(await shown(root, start.id), "card");
    const words = listOf(fieldsOf(card.card).lines).map((line) => textAt(line, "words"));
    assert.ok(words.includes(`P-52, not held: ${notHeldP52.sentence}`), words.join("\n"));
    assert.ok(words.includes("the first challenge answered P-52 not held; the designer answered once"));
    assert.ok(words.includes("findings left after the answer: 1"));
    const left = listOf(fieldsOf(card.card).lines).find((line) => textAt(line, "words").startsWith("finding, in"));
    assert.deepEqual(left, {
      mark: "judged",
      words: `finding, in ${finding.where}: ${finding.wrong} Fix: ${finding.fix}`,
      source: { step: "challenge-again" },
      skills: [{ mode: "forge", skill: "skills/challenge", tier: "deep" }],
      section: "checks",
    });
    assert.deepEqual(offeredOf(card), ["stop"]);
    assert.deepEqual(withheldOf(card), {
      approve:
        "The challenger answered P-52 not held, and a practice held by design must be held. The designer has " +
        "answered the challenge once, which is the most a design run asks.",
    });
    assert.deepEqual(
      factsOf(card, "problems").map((fact) => [fact.mark, fact.step, fact.short]),
      [
        ["judged", "challenge-again", true],
        ["judged", "design-again", false],
      ],
    );
    const stopped = runOf(await decided(root, card, { step: "card", choice: "stop" }));
    assert.equal(textAt(stopped, "reason"), "The owner chose stop on the design card, so nothing is committed.");
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(branches(root), []);
  });

  test("a practice the first challenge held and the second answers not held withholds approve: the second challenge's answers decide", async () => {
    const root = await project(template);
    const start = waitingOf(await startedDesign(root), "path");
    await decided(root, start, { step: "path", choice: "light" });
    await playedTo(root, start.id, {
      designer: (task) => Promise.resolve(inputOf(task).answering === undefined ? todoDesign : answeredDesign()),
      challenger: (task) =>
        Promise.resolve(
          inputOf(task).answered === undefined
            ? { ...fieldsOf(allHeld(task)), findings: [finding] }
            : p52NotHeld(task, []),
        ),
    });
    const card = waitingOf(await shown(root, start.id), "card");
    const words = listOf(fieldsOf(card.card).lines).map((line) => textAt(line, "words"));
    assert.ok(words.includes(`P-52, not held: ${notHeldP52.sentence}`), words.join("\n"));
    assert.ok(words.includes("the first challenge gave 1 finding; the designer answered once"));
    assert.deepEqual(offeredOf(card), ["stop"]);
  });

  test("a finding past the tenth, a finding's words past their bound, and a designer's sentence past its bound are sent back by their schemas", async () => {
    const root = await project(template);
    const start = waitingOf(await startedDesign(root), "path");
    await decided(root, start, { step: "path", choice: "light" });
    const long = "x".repeat(501);
    const overlong = { ...fieldsOf(todoDesign), practices: [{ id: "P-52", sentence: long }] };
    assert.notEqual(fieldsOf(await answered(root, start.id, overlong)).ok, true);
    assert.equal(fieldsOf(await answered(root, start.id, todoDesign)).ok, true);
    const challengerTask = await taskOf(root, start.id);
    const eleven = Array.from({ length: 11 }, (_, at) => ({ ...finding, where: `todo.add ${String(at)}` }));
    const tooMany = { ...fieldsOf(allHeld(challengerTask)), findings: eleven };
    assert.notEqual(fieldsOf(await answered(root, start.id, tooMany)).ok, true);
    const tooLong = { ...fieldsOf(allHeld(challengerTask)), findings: [{ ...finding, wrong: "y".repeat(301) }] };
    assert.notEqual(fieldsOf(await answered(root, start.id, tooLong)).ok, true);
    assert.equal(fieldsOf(await answered(root, start.id, allHeld(challengerTask))).ok, true);
  });

  test("a designs answer whose path is neither light nor full is refused, and no designer is asked again", async () => {
    const root = await project(template);
    const example = fieldsOf(jsonOf(await readFile(join(import.meta.dirname, "design-again.example.json"), "utf8")));
    const input = fieldsOf(example.input ?? null);
    const asked = { ...input, designs: { ...fieldsOf(input.designs ?? null), path: "sideways" } };
    const run = runOf(await bay(root, ["call", "forge.design-again", JSON.stringify(asked)]));
    assert.equal(textAt(run, "status"), "failed", JSON.stringify(run));
    assert.equal(
      textAt(run, "reason"),
      'The designs step names the path "sideways", which is neither light nor full, so no designer is asked again.',
    );
  });

  test("a design that does not say how it holds each practice it was given goes back to its designer with one sentence for each", async () => {
    const root = await project(template);
    const start = waitingOf(await startedDesign(root), "path");
    await decided(root, start, { step: "path", choice: "light" });
    const feedback: Json[] = [];
    const silent = Object.fromEntries(Object.entries(fieldsOf(todoDesign)).filter(([key]) => key !== "practices"));
    await playedTo(root, start.id, {
      designer: (task) => {
        feedback.push(fieldsOf(task).feedback ?? null);
        return Promise.resolve(feedback.length === 1 ? silent : todoDesign);
      },
      challenger: (task) => Promise.resolve(allHeld(task)),
    });
    const left = (id: string): string =>
      `The design does not say how it holds the practice ${id}; add it to practices with one sentence on how the ` +
      "design holds it, or why it does not apply.";
    assert.deepEqual(feedback, [[], [["P-52", "P-32", "P-35"].map(left).join(" ")]]);
    assert.equal(textAt(await shown(root, start.id), "status"), "waiting");
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
    const root = await processProject(template);
    const start = waitingOf(await startedDesign(root), "path");
    await decided(root, start, { step: "path", choice: "light" });
    const [todo = null] = listOf(fieldsOf(todoDesign).interfaces);
    const [add = null, ...others] = listOf(fieldsOf(todo).actions);
    const short = { ...fieldsOf(add), serves: ["O1-C1", "O1-C4", "O1-C5", "O1-C6", "O2-C4"] };
    const broken = { ...fieldsOf(todoDesign), interfaces: [{ ...fieldsOf(todo), actions: [short, ...others] }] };
    const feedback: Json[] = [];
    await playedTo(root, start.id, {
      designer: (task) => {
        feedback.push(fieldsOf(task).feedback ?? null);
        return Promise.resolve(broken);
      },
    });
    const sentence = `The condition O1-C7 of ${file} is served by no action; name it in serves of the action a person uses for it.`;
    assert.deepEqual(feedback.slice(1), [[sentence], [sentence]]);
    const run = await shown(root, start.id);
    assert.equal(textAt(run, "status"), "undone", JSON.stringify(run));
    assert.match(textAt(run, "reason"), /failed its checks in round 3, the last round: The condition O1-C7/);
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(branches(root), []);
  });

  test("the design card shows each problem of a worked example, beside the rules' problems, and withholds approve", async () => {
    const root = await project(template);
    const example = fieldsOf(jsonOf(await readFile(join(import.meta.dirname, "draw-design.example.json"), "utf8")));
    const input = fieldsOf(example.input ?? null);
    const again = fieldsOf(input.again ?? null);
    const design = fieldsOf(again.design ?? null);
    const [todo = null] = listOf(design.interfaces);
    const [add = null, ...others] = listOf(fieldsOf(todo).actions);
    const [first = null, ...rest] = listOf(fieldsOf(add).examples);
    const wrong = { ...fieldsOf(first), answer: { id: 0, text: "buy milk", status: "open" } };
    const actions = [{ ...fieldsOf(add), examples: [wrong, ...rest] }, ...others];
    const broken = { ...design, interfaces: [{ ...fieldsOf(todo), actions }] };
    const asked = { ...input, again: { ...again, design: broken } };
    const output = fieldsOf(
      fieldsOf(runOf(await bay(root, ["call", "forge.draw-design", JSON.stringify(asked)]))).output ?? null,
    );
    const words = listOf(fieldsOf(output.card ?? null).lines).map((line) => textAt(line, "words"));
    const sentence =
      'problem: The answer of example 1 of "todo.add" does not fit the response schema of "todo.add". At /id: id ' +
      "must be at least 1, but it is 0.";
    assert.ok(words.includes(sentence), words.join("\n"));
    assert.deepEqual(fieldsOf(output.offered ?? null), { approve: false });
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
    assert.equal(textAt(run, "status"), "undone", JSON.stringify(run));
    assert.match(textAt(run, "reason"), /failed its checks in round 3, the last round: The answer of example 1/);
    assert.deepEqual(worktrees(root), []);
  });
});
