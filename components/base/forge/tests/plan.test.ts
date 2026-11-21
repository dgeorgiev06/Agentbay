import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { listOf } from "../scripts/lib/json-values.ts";
import { planCard, type PlannerAnswer } from "../scripts/lib/plan-card.ts";
import { planDocument } from "../scripts/lib/plan-file.ts";
import { planOf } from "../scripts/lib/plan-form.ts";
import { sourcesGiven } from "../scripts/lib/plan-sources.ts";
import { workOut } from "../scripts/lib/plan-waves.ts";
import { practiceAnswersOf } from "../scripts/lib/practice-answers.ts";
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
  processProject,
  project,
  removeAll,
  runOf,
  shown,
  textAt,
  waitingOf,
  worktrees,
  type Asked,
} from "./kit-copy.ts";
import { printed } from "./printed-card.ts";
import { designFile, requirementsFile, tdOne, tdTwo, todoDesignFiles, todoPlan, writtenIn } from "./todo-plan.ts";

const skills = {
  "challenge-1": "forge skills/challenge-plan, tier deep",
  "challenge-2": "forge skills/challenge-plan, tier deep",
};

const finding = "TD2's item 2 names no refusal; add the refused id 99 to its sentence.";

const left = "TD2's title is longer than the card shows.";

const p34Sentence = "TD2 writes the folder TD1 makes, and nothing orders them.";

const answeredPlan = {
  ...fieldsOf(todoPlan),
  slices: [tdOne, { ...fieldsOf(tdTwo), title: "The todo mode marks a todo done, removes one, and refuses id 99" }],
};

function withP34NotHeld(task: Json): Json {
  const answer = fieldsOf(answers(task, []));
  const practices = listOf(answer.practices).map((practice) =>
    textAt(practice, "id") === "P-34" ? { id: "P-34", answer: "not-held", sentence: p34Sentence } : practice,
  );
  return { ...answer, practices };
}

let template: string;

before(async () => {
  template = await kitTemplate();
});

after(async () => {
  await removeAll();
});

async function designed(root: string): Promise<string> {
  const folder = join(root, ".designed");
  git(root, ["worktree", "add", "-q", folder, into]);
  await writtenIn(folder, todoDesignFiles());
  git(folder, ["add", "docs/designs"]);
  git(folder, ["commit", "-q", "-m", "todo: the design"]);
  git(root, ["worktree", "remove", folder]);
  return root;
}

async function startedPlan(root: string): Promise<Json> {
  const trigger = JSON.stringify({ design: designFile });
  return runOf(await bay(root, ["call", "--workflow", "forge:workflows/plan.yaml", trigger]));
}

function answers(task: Json, findings: readonly string[]): Json {
  const practices = listOf(fieldsOf(fieldsOf(task).input ?? null).practices);
  const held = practices.map((practice) => ({ id: textAt(practice, "id"), answer: "held", sentence: "It holds." }));
  return { practices: held, findings: [...findings] };
}

async function requirementsIn(root: string): Promise<Json> {
  const read = readYaml(await readFile(join(root, requirementsFile), "utf8"));
  assert.ok(read.ok);
  return read.value;
}

type Expected = {
  readonly plan: Json;
  readonly challenge: Json;
  readonly challenger: string;
  readonly answer: PlannerAnswer;
};

async function expectedCard(root: string, expected: Expected): Promise<string> {
  const [file] = todoDesignFiles();
  const parsed = readYaml(file?.text ?? "");
  assert.ok(parsed.ok);
  const document = parsed.value;
  const requirements = await requirementsIn(root);
  const sources = sourcesGiven({ file: requirementsFile, requirements, design: designFile, document });
  const plan = planOf(planDocument(expected.plan, { requirements: requirementsFile, design: designFile }));
  const drawn = planCard({
    job: "todo",
    into,
    design: sources.design,
    conditions: sources.conditions,
    plan,
    workedOut: workOut(plan, [], sources),
    practices: practiceAnswersOf(fieldsOf(expected.challenge).practices),
    findings: listOf(fieldsOf(expected.challenge).findings).map(String),
    challenger: expected.challenger,
    answer: expected.answer,
  });
  const reason = drawn.card.withheld.approve;
  const approve = { name: "approve", does: "Commit the plan" };
  const choices = [reason === undefined ? approve : { ...approve, withheld: reason }];
  return printed(drawn.card, [...choices, { name: "stop", does: "Stop; nothing is committed" }], { skills });
}

function actions(asked: readonly Asked[]): readonly string[] {
  return asked.map((each) => `${each.step} ${each.action}`);
}

describe("the workflow plan, from the committed todo design", { concurrency: true }, () => {
  test("with no finding the card is as printed, the planner and the challenger run once, and approve commits the plan with the first wave's slice requests", async () => {
    const root = await designed(await project(template));
    const run = await startedPlan(root);
    const challenges: Json[] = [];
    const asked = await playedTo(root, textAt(run, "id"), {
      planner: () => Promise.resolve(todoPlan),
      planChallenger: (task) => {
        challenges.push(answers(task, []));
        return Promise.resolve(challenges.at(-1) ?? null);
      },
    });
    assert.deepEqual(actions(asked), ["plan-1/0#1 plan", "challenge-1/0#1 challenge-plan"]);
    const card = waitingOf(await shown(root, textAt(run, "id")), "card");
    const expected = { plan: todoPlan, challenge: challenges[0] ?? null, challenger: "challenge-1" };
    assert.deepEqual(
      await printedCard(root, card.id, "Commit the plan"),
      (await expectedCard(root, { ...expected, answer: { kind: "not asked" } })).split("\n"),
    );
    const done = runOf(await decided(root, card, { step: "card", choice: "approve" }));
    assert.equal(textAt(done, "status"), "done", JSON.stringify(done));
    const output = fieldsOf(fieldsOf(done).output ?? null);
    const commit = textAt(output, "commit");
    assert.deepEqual(
      { plan: output.plan, into: output.into, merged: output.merged },
      { plan: "docs/plans/0025-todo.yaml", into, merged: git(root, ["rev-parse", into]).trim() },
    );
    const committed = git(root, ["show", "--name-only", "--format=", commit])
      .split("\n")
      .filter((line) => line !== "");
    assert.deepEqual(committed, ["docs/plans/0025-todo.yaml"]);
    const kept = readYaml(git(root, ["show", `${into}:docs/plans/0025-todo.yaml`]));
    assert.ok(kept.ok);
    assert.deepEqual(kept.value, planDocument(todoPlan, { requirements: requirementsFile, design: designFile }));
    const request = {
      planned: { title: fieldsOf(tdOne).title, slice: fieldsOf(tdOne).slice },
      base: commit,
      bugs: [],
      interface: fieldsOf(tdOne).interface,
    };
    assert.deepEqual(output.wave, [request]);
    const sliced = runOf(await bay(root, ["call", "forge.slice", JSON.stringify({ request, planter: true })]));
    assert.equal(textAt(sliced, "status"), "done", JSON.stringify(sliced));
    assert.deepEqual(fieldsOf(fieldsOf(sliced).output ?? null).offered, {
      build: true,
      "build-without-interface": false,
      "build-over": false,
      "build-over-without-interface": false,
    });
    const text = git(root, ["show", `${into}:docs/plans/0025-todo.yaml`]);
    await writtenIn(root, [...todoDesignFiles(), { path: "docs/plans/0025-todo.yaml", text }]);
    const waves = runOf(
      await bay(root, ["call", "forge.waves", JSON.stringify({ plan: "docs/plans/0025-todo.yaml" })]),
    );
    assert.deepEqual(fieldsOf(fieldsOf(waves).output ?? null).problems, []);
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(branches(root), []);
    const second = await startedPlan(root);
    await playedTo(root, textAt(second, "id"), {
      planner: () => Promise.resolve(todoPlan),
      planChallenger: (task) => Promise.resolve(answers(task, [])),
    });
    const secondCard = waitingOf(await shown(root, textAt(second, "id")), "card");
    const again = runOf(await decided(root, secondCard, { step: "card", choice: "approve" }));
    assert.equal(textAt(again, "status"), "done", JSON.stringify(again));
    assert.equal(textAt(fieldsOf(again).output ?? null, "plan"), "docs/plans/0026-todo.yaml");
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(branches(root), []);
  });

  test("a challenge that leaves out a practice is sent back; one with a finding runs the planner's second round and a second challenge, whose finding left the card cites", async () => {
    const root = await designed(await project(template));
    const run = await startedPlan(root);
    const tasks: Json[] = [];
    const answered = answeredPlan;
    const asked = await playedTo(root, textAt(run, "id"), {
      planner: (task) =>
        Promise.resolve(fieldsOf(fieldsOf(task).input ?? null).answering === undefined ? todoPlan : answered),
      planChallenger: (task) => {
        tasks.push(task);
        const step = textAt(task, "stepKey");
        const answer = answers(task, step.startsWith("challenge-1") ? [finding] : [left]);
        const short = { ...fieldsOf(answer), practices: listOf(fieldsOf(answer).practices).slice(1) };
        return Promise.resolve(step === "challenge-1/0#1" ? short : answer);
      },
    });
    assert.deepEqual(actions(asked), [
      "plan-1/0#1 plan",
      "challenge-1/0#1 challenge-plan",
      "challenge-1/0#2 challenge-plan",
      "plan-2/0.call0/0#1 plan",
      "challenge-2/0.call0/0#1 challenge-plan",
    ]);
    assert.deepEqual(fieldsOf(tasks[1] ?? null).feedback, [
      "The challenge leaves out the practice P-33; answer every practice held by a plan, each held, not-held or " +
        "does-not-apply, with its sentence.",
    ]);
    const second = asked[3]?.task ?? null;
    assert.deepEqual(fieldsOf(fieldsOf(second).input ?? null).answering, {
      plan: todoPlan,
      practices: [],
      findings: [finding],
    });
    assert.deepEqual(fieldsOf(fieldsOf(tasks[2] ?? null).input ?? null).answered, {
      practices: [],
      findings: [finding],
    });
    const card = waitingOf(await shown(root, textAt(run, "id")), "card");
    const expected = {
      plan: answered,
      challenge: answers(tasks[2] ?? null, [left]),
      challenger: "challenge-2",
      answer: { kind: "answered", changes: ["TD2's title"], notHeld: [], findings: 1 },
    } as const;
    assert.deepEqual(
      await printedCard(root, card.id, "Commit the plan"),
      (await expectedCard(root, expected)).split("\n"),
    );
    const judged = listOf(fieldsOf(card.card).lines).filter((line) => textAt(line, "mark") === "judged");
    assert.deepEqual(
      judged.map((line) => textAt(fieldsOf(line).source ?? null, "step")),
      ["challenge-2"],
    );
    const stopped = runOf(await decided(root, card, { step: "card", choice: "stop" }));
    assert.equal(textAt(stopped, "reason"), "The owner chose stop on the plan card, so nothing is committed.");
    assert.equal(git(root, ["ls-tree", "--name-only", into, "docs/plans/0025-todo.yaml"]), "");
    assert.deepEqual(branches(root), []);
    assertTheMainCheckoutIsUntouched(root);
  });

  test("a practice not held with no finding runs the planner's second round and a second challenge; still not held, the card offers only stop and says the planner answered once", async () => {
    const root = await designed(await project(template));
    const run = await startedPlan(root);
    const tasks: Json[] = [];
    const asked = await playedTo(root, textAt(run, "id"), {
      planner: (task) =>
        Promise.resolve(fieldsOf(fieldsOf(task).input ?? null).answering === undefined ? todoPlan : answeredPlan),
      planChallenger: (task) => {
        tasks.push(task);
        return Promise.resolve(withP34NotHeld(task));
      },
    });
    assert.deepEqual(actions(asked), [
      "plan-1/0#1 plan",
      "challenge-1/0#1 challenge-plan",
      "plan-2/0.call0/0#1 plan",
      "challenge-2/0.call0/0#1 challenge-plan",
    ]);
    const notHeld = [{ id: "P-34", answer: "not-held", sentence: p34Sentence }];
    assert.deepEqual(fieldsOf(fieldsOf(asked[2]?.task ?? null).input ?? null).answering, {
      plan: todoPlan,
      practices: notHeld,
      findings: [],
    });
    assert.deepEqual(fieldsOf(fieldsOf(tasks[1] ?? null).input ?? null).answered, { practices: notHeld, findings: [] });
    const card = waitingOf(await shown(root, textAt(run, "id")), "card");
    const expected = {
      plan: answeredPlan,
      challenge: withP34NotHeld(tasks[1] ?? null),
      challenger: "challenge-2",
      answer: { kind: "answered", changes: ["TD2's title"], notHeld: ["P-34"], findings: 0 },
    } as const;
    const rows = await printedCard(root, card.id, "Commit the plan");
    assert.deepEqual(rows, (await expectedCard(root, expected)).split("\n"));
    assert.ok(rows.includes("           why: The challenger answered P-34"), rows.join("\n"));
    const words = listOf(fieldsOf(card.card).lines).map((line) => textAt(line, "words"));
    assert.ok(words.includes("the first challenge answered P-34 not held; the planner answered once"));
    const stopped = runOf(await decided(root, card, { step: "card", choice: "stop" }));
    assert.equal(textAt(stopped, "reason"), "The owner chose stop on the plan card, so nothing is committed.");
    assert.deepEqual(branches(root), []);
  });

  test("a plan with a condition no slice meets goes back to its planner with the problem, and the run stops with it", async () => {
    const root = await designed(await processProject(template));
    const run = await startedPlan(root);
    const short = { ...fieldsOf(tdTwo), meets: ["O2-C1", "O2-C2", "O2-C3", "O2-C5", "O2-C6"] };
    const feedback: Json[] = [];
    await playedTo(root, textAt(run, "id"), {
      planner: (task) => {
        feedback.push(fieldsOf(task).feedback ?? null);
        return Promise.resolve({ ...fieldsOf(todoPlan), slices: [tdOne, short] });
      },
    });
    const sentence =
      "No slice meets the condition O2-C4 of docs/requirements/todo.yaml. Name it in meets of the slice that makes " +
      "it true, or add a slice for it.";
    assert.deepEqual(feedback.slice(1), [[sentence], [sentence]]);
    const failed = await shown(root, textAt(run, "id"));
    assert.equal(textAt(failed, "status"), "undone", JSON.stringify(failed));
    assert.match(
      textAt(failed, "reason"),
      /failed its checks in round 3, the last round: No slice meets the condition O2-C4/,
    );
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(branches(root), []);
  });

  test("a refused requirements file stops the run with every problem and its line, and no plan is written", async () => {
    const root = await designed(await project(template));
    const text = await readFile(join(root, requirementsFile), "utf8");
    await writeFile(join(root, requirementsFile), text.replace("        then: 0 todos are listed\n", ""), "utf8");
    const run = await startedPlan(root);
    assert.equal(textAt(run, "status"), "undone", JSON.stringify(run));
    assert.equal(
      textAt(run, "reason"),
      `requirements.check refused ${requirementsFile} for 1 problem, so no plan is written; correct each and run ` +
        "the plan again: line 27: O1-C3: outcomes.0.conditions.2 is missing the required field then. Add then.",
    );
    assert.deepEqual(worktrees(root), []);
  });
});
