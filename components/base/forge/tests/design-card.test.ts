import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { challengeOf, refusedChallenge, type PracticeAnswer } from "../scripts/lib/challenge-answer.ts";
import { designCard, type DesignCardInput } from "../scripts/lib/design-card.ts";
import { differences } from "../scripts/lib/design-compare.ts";
import { designOf } from "../scripts/lib/design-form.ts";
import { listOf } from "../scripts/lib/json-values.ts";
import { pathCard } from "../scripts/lib/path-card.ts";
import { conditionsOf, requirementsOf, type Requirements } from "../scripts/lib/requirements-form.ts";
import { printed } from "./printed-card.ts";
import { todoDesign, todoHides } from "./todo-design.ts";

const file = "docs/requirements/todo.yaml";

const skills = {
  designs: "forge skills/design, tier deep",
  challenge: "forge skills/challenge, tier deep",
};

const pathChoices = [
  { name: "light", does: "One designer, then a challenger" },
  { name: "full", does: "Two designers apart, then a comparison" },
  { name: "stop", does: "Stop; nothing is designed" },
];

const allHeld: readonly PracticeAnswer[] = [
  { id: "P-52", answer: "held", sentence: "The rules of a todo are pure functions." },
  { id: "P-32", answer: "does-not-apply", sentence: "The mode has no skill step." },
  { id: "P-35", answer: "held", sentence: "The one module names its interface first." },
];

const p52NotHeld: readonly PracticeAnswer[] = [
  { id: "P-52", answer: "not-held", sentence: "The add action decides the next id and writes it in one script." },
  ...allHeld.slice(1),
];

async function todoRequirements(): Promise<Requirements> {
  const text = await readFile(new URL(`../../../../${file}`, import.meta.url), "utf8");
  const read = readYaml(text);
  assert.ok(read.ok);
  return requirementsOf(read.value);
}

function printedDesign(input: DesignCardInput): string {
  const drawn = designCard(input);
  const reason = drawn.card.withheld.approve;
  const approve = { name: "approve", does: "Commit the design and its schema files" };
  const choices = [reason === undefined ? approve : { ...approve, withheld: reason }];
  return printed(drawn.card, [...choices, { name: "stop", does: "Stop; nothing is committed" }], skills);
}

async function lightInput(practices: readonly PracticeAnswer[]): Promise<DesignCardInput> {
  return {
    file,
    requirements: await todoRequirements(),
    path: "light",
    chosen: "first",
    because: "It is the one design.",
    design: designOf(todoDesign),
    problems: [],
    practices,
    differences: [],
  };
}

const firstCard = `Which path for the design of todo?
  requirements: docs/requirements/todo.yaml,
    version 1, signed by owner
  O1, 7 conditions: A person adds a todo and
    sees it among the open ones.
  O2, 6 conditions: A person marks a todo
    done, or removes it.
  in all: 2 outcomes, 13 conditions; 5 left
    out on purpose
  light: one designer, then a challenger who
    answers the practices held by design: 2
    calls at tier deep, up to 6 when checks
    send them back
  full: two designers who write apart, then
    a challenger who compares the two and
    chooses: 3 calls at tier deep, up to 9
    when checks send them back
  either path writes each action's request
    and response as schema files
All lines worked out by script.
You can:
  light  One designer, then a challenger
  full   Two designers apart, then a
         comparison
  stop   Stop; nothing is designed
checked: 0 ran, 7 computed, 0 judged`;

const designHead = `Commit the design of todo?
  the one design, on the light path; approve
    is offered
  requirements: docs/requirements/todo.yaml:
    2 outcomes, 13 conditions
  module todo: implements todo; owns the
    table todos
judged   todo hides: How todos are kept,
judged     numbered and never given a
judged     removed id again.
judged    by forge skills/design, tier deep
  interface todo: 4 actions, 8 schema files
  add: serves O1-C1, O1-C4, O1-C5, O1-C6,
    O1-C7, O2-C4; 3 examples
  list: serves O1-C1, O1-C2, O1-C3, O2-C1,
    O2-C2, O2-C3; 2 examples
  done: serves O2-C1, O2-C2, O2-C5, O2-C6; 3
    examples
  remove: serves O2-C3, O2-C5; 2 examples
  coverage: every condition is served by an
    action: yes
  checked by script: 13 rules of the design,
    no problem
  examples: 10, not checked against their
    schemas, since the toolbox checks a
    value only against a schema file
  practices held by the script's rules:
    P-35, P-36, P-38 and P-42`;

const lightAllHeld = `${designHead}
  practices answered by the challenger: 3; 2
    held, 0 not held, 1 do not apply
  one design was written, so none was
    compared
Unmarked lines were worked out by script.
You can:
  approve  Commit the design and its schema
           files
  stop     Stop; nothing is committed
checked: 0 ran, 14 computed, 1 judged`;

const lightNotHeld = `${designHead.replace("approve\n    is offered", "approve\n    is not offered")}
  practices answered by the challenger: 3; 1
    held, 1 not held, 1 do not apply
judged   P-52, not held: The add action
judged     decides the next id and writes it
judged     in one script.
judged    by forge skills/challenge, tier
judged      deep
  one design was written, so none was
    compared
Unmarked lines were worked out by script.
You can:
  stop  Stop; nothing is committed
Not available:
  approve  Commit the design and its schema
           files
           why: The challenger answered P-52
           not held, and a practice held by
           design must be held.
checked: 0 ran, 14 computed, 2 judged`;

function renamed(design: Json): Json {
  const fields = fieldsOf(design);
  const [module = null] = listOf(fields.modules);
  const store = { name: "store", hides: "Where todos are written.", implements: ["todo"], owns: { tables: ["todos"] } };
  return { ...fields, modules: [{ ...fieldsOf(module), owns: {} }, store] };
}

describe("the design's first card and the design card, for the todo mode", () => {
  test("the first card shows the outcomes, the count of conditions and what each path costs, as printed", async () => {
    assert.equal(printed(pathCard(file, await todoRequirements()), pathChoices), firstCard);
  });

  test("the mode's designer and challenger run at tier deep, which the first card names", async () => {
    const read = readYaml(await readFile(new URL("../mode.yaml", import.meta.url), "utf8"));
    assert.ok(read.ok);
    const actions = fieldsOf(fieldsOf(read.value).actions ?? null);
    const tierOf = (name: string): Json => {
      const [first = null] = listOf(fieldsOf(actions[name] ?? null).run);
      return fieldsOf(first).tier ?? null;
    };
    assert.deepEqual([tierOf("design"), tierOf("challenge")], ["deep", "deep"]);
  });

  test("the design card on the light path, every practice held, offers approve, line by line", async () => {
    assert.equal(printedDesign(await lightInput(allHeld)), lightAllHeld);
  });

  test("a practice held by design that the challenger answered not held withholds approve with its reason", async () => {
    assert.equal(printedDesign(await lightInput(p52NotHeld)), lightNotHeld);
  });

  test("a design that breaks a rule withholds approve and shows each problem", async () => {
    const drawn = designCard({ ...(await lightInput(allHeld)), problems: ["The action x has no example."] });
    assert.deepEqual(drawn.offered, { approve: false });
    assert.equal(drawn.card.withheld.approve, "The design check found 1 problem.");
    const words = drawn.card.lines.map((line) => line.words);
    assert.ok(words.includes("problem: The action x has no example."), words.join("\n"));
  });

  test("on the full path a merged design's lines cite the challenger, and the card lists where the two differed", async () => {
    const requirements = await todoRequirements();
    const first = designOf(todoDesign);
    const second = designOf(renamed(todoDesign));
    const listed = differences({ first, second }, conditionsOf(requirements));
    assert.deepEqual(listed, ["module store: only in the second design", "module todo: implements or owns differ"]);
    const drawn = designCard({
      ...(await lightInput(allHeld)),
      path: "full",
      chosen: "merged",
      because: "The second keeps the table apart.",
      design: second,
      differences: listed,
    });
    const hides = drawn.card.lines.find((line) => line.words === `todo hides: ${todoHides}`);
    assert.deepEqual(hides?.source, { step: "challenge" });
    const words = drawn.card.lines.map((line) => line.words);
    assert.deepEqual(words.slice(0, 1), ["a design the challenger merged from two written apart; approve is offered"]);
    assert.deepEqual(words.slice(-4), [
      "where the two designs differed: 2",
      "module store: only in the second design",
      "module todo: implements or owns differ",
      "chosen because: The second keeps the table apart.",
    ]);
  });
});

describe("the comparison and the challenger's answer", () => {
  test("two designs that differ in actions, schemas and coverage are listed by script", () => {
    const first = designOf(todoDesign);
    const [todo] = first.interfaces;
    assert.ok(todo !== undefined);
    const [add, list, done] = todo.actions;
    assert.ok(add !== undefined && list !== undefined && done !== undefined);
    const second = {
      ...first,
      interfaces: [{ ...todo, actions: [{ ...add, request: {} }, list, { ...done, name: "close" }] }],
    };
    assert.deepEqual(differences({ first, second }, ["O2-C3", "O2-C6"]), [
      "action todo.done: only in the first design",
      "action todo.remove: only in the first design",
      "action todo.close: only in the second design",
      "todo.add: the request schemas differ",
      "O2-C3: served by todo.list, todo.remove in the first, by todo.list in the second",
      "O2-C6: served by todo.done in the first, by todo.close in the second",
    ]);
  });

  test("a challenge that leaves a practice out, answers one twice or one not given, or chooses what was not written, is sent back", () => {
    const asked = { designs: 1, practices: ["P-32", "P-35", "P-52"] };
    const answered = (id: string): Json => ({ id, answer: "held", sentence: "It holds." });
    const challenge = challengeOf({
      chosen: "second",
      because: "It is better.",
      practices: [answered("P-35"), answered("P-35"), answered("P-99"), answered("P-52")],
    });
    assert.deepEqual(refusedChallenge(challenge, asked, []), [
      "The challenge leaves out the practice P-32; answer every practice held by design, each held, not-held or does-not-apply, with its sentence.",
      "The challenge answers P-99, which is not a practice held by design; answer only P-32, P-35 and P-52.",
      "The challenge answers P-35 more than once; answer each practice once.",
      "The challenge chose second, but only one design was written; choose first.",
    ]);
  });

  test("a merged choice needs a design, a design needs the merged choice, and a merged design that breaks a rule is sent back", () => {
    const asked = { designs: 2, practices: [] };
    const merged = challengeOf({ chosen: "merged", because: "Both.", practices: [] });
    assert.deepEqual(refusedChallenge(merged, asked, []), [
      "The challenge chose merged but gave no design; give the merged design, or choose first or second.",
    ]);
    const first = challengeOf({ chosen: "first", design: todoDesign, because: "One.", practices: [] });
    assert.deepEqual(refusedChallenge(first, asked, []), [
      "The challenge gave a design but chose first; give a design only when you choose merged.",
    ]);
    const given = challengeOf({ chosen: "merged", design: todoDesign, because: "Both.", practices: [] });
    assert.deepEqual(refusedChallenge(given, asked, ["The action x has no example."]), [
      "The merged design is refused: The action x has no example.",
    ]);
  });
});
