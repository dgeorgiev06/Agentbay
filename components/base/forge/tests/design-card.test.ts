import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { challengeOf, refusedChallenge, type Challenge, type Finding } from "../scripts/lib/challenge-answer.ts";
import { answeringStance } from "../scripts/lib/design-again.ts";
import { foundOf, secondPassNeeded } from "../scripts/lib/second-round.ts";
import { designCard, type DesignCard, type DesignCardInput, type SecondPass } from "../scripts/lib/design-card.ts";
import { answerChanges, differences } from "../scripts/lib/design-compare.ts";
import { problemsByCheck } from "../scripts/lib/design-rules.ts";
import { designOf } from "../scripts/lib/design-form.ts";
import { listOf } from "../scripts/lib/json-values.ts";
import { pathCard } from "../scripts/lib/path-card.ts";
import { designerPracticeProblems, type PracticeAnswer } from "../scripts/lib/practice-answers.ts";
import { conditionsOf, requirementsOf, type Requirements } from "../scripts/lib/requirements-form.ts";
import { factOf, type Fact } from "./kit-copy.ts";
import { printed } from "./printed-card.ts";
import { todoDesign, todoHides } from "./todo-design.ts";
import { todoVersionOne } from "./todo-plan.ts";

const file = "docs/requirements/todo.yaml";

const checksRun = problemsByCheck({ job: "todo", file, conditions: [], design: designOf(todoDesign) }).length;

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
  const text = await readFile(todoVersionOne, "utf8");
  const read = readYaml(text);
  assert.ok(read.ok);
  return requirementsOf(read.value);
}

function factsIn(drawn: DesignCard, section: string): readonly Fact[] {
  return drawn.card.lines.map((line) => factOf({ ...line })).filter((fact) => fact.section === section);
}

function shortWords(drawn: DesignCard, section: string): readonly string[] {
  return factsIn(drawn, section)
    .filter((fact) => fact.short)
    .map((fact) => fact.words);
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
    checks: checksRun,
    refusedSchemas: 0,
    practices,
    findings: [],
    said: [],
    differences: [],
  };
}

const answeredP52: SecondPass = {
  notHeld: ["P-52"],
  findings: 1,
  changes: ["module todo-rules: only in the answered design", "module todo: implements or owns differ"],
};

const stillNotHeld: readonly PracticeAnswer[] = [
  { id: "P-52", answer: "not-held", sentence: "The add action still decides the next id and writes it in one script." },
  ...allHeld.slice(1),
];

const refusalExample: Finding = {
  wrong: "No example shows the open list after a refusal.",
  where: "todo.add",
  fix: "Add an example that lists the open todos after the refused add.",
};

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
    calls at tier deep, 4 when the designer
    answers the challenger once, up to 12
    when checks send them back
  full: two designers who write apart, then
    a challenger who compares the two and
    chooses: 3 calls at tier deep, 5 when
    the designer answers the challenger
    once, up to 15 when checks send them
    back
  either path writes each action's request
    and response as schema files
All lines worked out by script.
You can:
  light  One designer, then a challenger
  full   Two designers apart, then a
         comparison
  stop   Stop; nothing is designed
checked: 0 ran, 7 computed, 0 judged`;

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

  test("the mode's design and challenge steps name the designer and the challenger, whose tier deep the first card names", async () => {
    const read = readYaml(await readFile(new URL("../mode.yaml", import.meta.url), "utf8"));
    assert.ok(read.ok);
    const actions = fieldsOf(fieldsOf(read.value).actions ?? null);
    const roleOf = (name: string): Json => {
      const [first = null] = listOf(fieldsOf(actions[name] ?? null).run);
      return fieldsOf(first).role ?? null;
    };
    assert.deepEqual([roleOf("design"), roleOf("challenge")], ["designer", "challenger"]);
  });

  test("the design card on the light path, every practice held, offers approve and leads with what it is and its checks", async () => {
    const drawn = designCard(await lightInput(allHeld));
    assert.deepEqual(drawn.offered, { approve: true });
    assert.deepEqual(drawn.card.withheld, {});
    assert.equal(drawn.card.title, "Commit the design of todo?");
    assert.deepEqual(shortWords(drawn, "what"), [
      "1 module, 4 actions: add, list, done and remove.",
      "Covers all 13 of your conditions.",
    ]);
    assert.deepEqual(shortWords(drawn, "checks"), [
      `${String(checksRun)} automatic checks: no problem found.`,
      "A second model reviewed it and reported no findings and no practice not held.",
    ]);
    assert.deepEqual(factsIn(drawn, "problems"), []);
    assert.deepEqual(factsIn(drawn, "open"), []);
    const judged = factsIn(drawn, "what").filter((fact) => fact.mark === "judged");
    assert.deepEqual([judged.length, [...new Set(judged.map((fact) => fact.step))]], [4, ["designs"]]);
    assert.deepEqual([factsIn(drawn, "what").length, factsIn(drawn, "checks").length], [18, 7]);
  });

  test("a practice held by design that the challenger answered not held withholds approve with its reason", async () => {
    const drawn = designCard(await lightInput(p52NotHeld));
    assert.deepEqual(drawn.offered, { approve: false });
    assert.deepEqual(drawn.card.withheld, {
      approve: "The challenger answered P-52 not held, and a practice held by design must be held.",
    });
    assert.deepEqual(factsIn(drawn, "problems"), [
      {
        section: "problems",
        short: true,
        mark: "judged",
        words: "P-52, not held: The add action decides the next id and writes it in one script.",
        step: "challenge",
      },
    ]);
    assert.equal(
      shortWords(drawn, "checks")[1],
      "A second model reviewed it and reported no findings and 1 practice not held (P-52).",
    );
  });

  test("after a second pass that holds every practice, the checks say what the first challenge found, that the designer answered once and what changed, and approve is offered", async () => {
    const drawn = designCard({ ...(await lightInput(allHeld)), second: answeredP52 });
    assert.deepEqual(drawn.offered, { approve: true });
    const checks = factsIn(drawn, "checks").map((fact) => fact.words);
    const changed = checks.indexOf("what the answer changed, by script: 2");
    assert.deepEqual(checks.slice(changed - 1, changed + 4), [
      "the first challenge answered P-52 not held and gave 1 finding; the designer answered once",
      "what the answer changed, by script: 2",
      ...answeredP52.changes,
      "the second challenge's answers decide the card",
    ]);
    assert.ok(checks.includes("findings left after the answer: none"), checks.join("\n"));
    assert.ok(
      factsIn(drawn, "what").some(
        (fact) =>
          fact.words ===
          "the one design, on the light path, answered once after the first challenge; approve is offered",
      ),
    );
  });

  test("after a second pass that leaves a practice not held, the second challenge's answer and the designer's own sentence are the problems, the finding left is a check, and only stop is offered", async () => {
    const input = {
      ...(await lightInput(stillNotHeld)),
      second: answeredP52,
      said: [
        { id: "P-52", sentence: "The module todo-rules decides the next id; todo reads and writes around it." },
        { id: "P-32", sentence: "The mode has no skill step." },
      ],
      findings: [refusalExample],
    };
    const drawn = designCard(input);
    assert.deepEqual(drawn.offered, { approve: false });
    assert.equal(
      drawn.card.withheld.approve,
      "The challenger answered P-52 not held, and a practice held by design must be held. The designer has " +
        "answered the challenge once, which is the most a design run asks.",
    );
    assert.deepEqual(
      factsIn(drawn, "problems").map((fact) => [fact.short, fact.mark, fact.step, fact.words]),
      [
        [true, "judged", "challenge-again", `P-52, not held: ${stillNotHeld[0]?.sentence ?? ""}`],
        [
          false,
          "judged",
          "design-again",
          "P-52, as the designer answered: The module todo-rules decides the next id; todo reads and writes around it.",
        ],
      ],
    );
    const finding = factsIn(drawn, "checks").find((fact) => fact.words.startsWith("finding, in todo.add:"));
    assert.deepEqual([finding?.mark, finding?.step, finding?.short], ["judged", "challenge-again", false]);
    assert.equal(
      shortWords(drawn, "checks")[1],
      "A second model reviewed it and reported 1 finding and 1 practice not held (P-52).",
    );
  });

  test("a finding with every practice held is shown as judged by the challenger and withholds nothing, as on the plan card", async () => {
    const drawn = designCard({ ...(await lightInput(allHeld)), findings: [refusalExample] });
    assert.deepEqual(drawn.offered, { approve: true });
    const finding = drawn.card.lines.find((line) => line.words.startsWith("finding, in todo.add:"));
    assert.deepEqual(finding?.source, { step: "challenge" });
  });

  test("the examples' line says each was checked when none ends in a refusal, and names every check not made", async () => {
    const input = await lightInput(allHeld);
    const examplesLine = (drawn: DesignCardInput): string | undefined =>
      designCard(drawn).card.lines.find((line) => line.words.startsWith("examples:"))?.words;
    const [todo] = input.design.interfaces;
    assert.ok(todo !== undefined);
    const answered = todo.actions.map((action) => ({
      ...action,
      examples: action.examples.filter((example) => "answer" in example.told),
    }));
    const noRefusal = { ...input.design, interfaces: [{ ...todo, actions: answered }] };
    assert.equal(
      examplesLine({ ...input, design: noRefusal }),
      "examples: 6, each checked against its action's schemas",
    );
    assert.equal(
      examplesLine({ ...input, design: noRefusal, refusedSchemas: 1 }),
      "examples: 6, checked against their actions' schemas, but not against the 1 schema the kernel refused",
    );
    assert.equal(
      examplesLine({ ...input, refusedSchemas: 2 }),
      "examples: 10, checked against their actions' schemas, but not the input of the 4 refusals and against the 2 " +
        "schemas the kernel refused",
    );
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
    const what = factsIn(drawn, "what").map((fact) => fact.words);
    assert.ok(what.includes("a design the challenger merged from two written apart; approve is offered"));
    assert.deepEqual(what.slice(-4), [
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

  test("the designer answers once only when the first challenge answered a practice not held or gave a finding", () => {
    const challenge = (practices: readonly PracticeAnswer[], findings: readonly Finding[]): Challenge =>
      challengeOf({ chosen: "first", because: "One.", practices: [...practices], findings: [...findings] });
    assert.equal(secondPassNeeded(challenge(allHeld, [])), false);
    assert.equal(secondPassNeeded(challenge(p52NotHeld, [])), true);
    assert.equal(secondPassNeeded(challenge(allHeld, [refusalExample])), true);
    assert.deepEqual(foundOf(challenge(p52NotHeld, [refusalExample])), {
      practices: [p52NotHeld[0]],
      findings: [refusalExample],
    });
  });

  test("the second pass goes to the designer of the chosen design, and a merged design to the first stance's", () => {
    assert.equal(answeringStance("light", "first"), "first");
    assert.equal(answeringStance("full", "first"), "first");
    assert.equal(answeringStance("full", "second"), "second");
    assert.equal(answeringStance("full", "merged"), "first");
  });

  test("a design that leaves out a practice it was given, answers one not given or one twice, is sent back", () => {
    assert.deepEqual(designerPracticeProblems(["P-32", "P-35", "P-52"], ["P-35", "P-99", "P-52", "P-52"]), [
      "The design does not say how it holds the practice P-32; add it to practices with one sentence on how the " +
        "design holds it, or why it does not apply.",
      "The design answers P-99, which is not a practice held by design; answer only P-32, P-35 and P-52.",
      "The design answers P-52 more than once; answer each practice once.",
    ]);
    assert.deepEqual(designerPracticeProblems([], []), []);
  });

  test("the answer's changes list a module's hides worded anew, an example dropped and a practice's sentence changed, and nothing for the same design", () => {
    const fields = fieldsOf(todoDesign);
    const [module = null] = listOf(fields.modules);
    const [todo = null] = listOf(fields.interfaces);
    const [add = null, ...others] = listOf(fieldsOf(todo).actions);
    const [, ...laterExamples] = listOf(fieldsOf(add).examples);
    const reworded = { ...fields, modules: [{ ...fieldsOf(module), hides: "How todos are kept." }] };
    const dropped = {
      ...fields,
      interfaces: [{ ...fieldsOf(todo), actions: [{ ...fieldsOf(add), examples: laterExamples }, ...others] }],
    };
    const [said = null, ...rest] = listOf(fields.practices);
    const resaid = { ...fields, practices: [{ ...fieldsOf(said), sentence: "No skill step at all." }, ...rest] };
    const conditions = ["O1-C1"];
    assert.deepEqual(answerChanges(todoDesign, todoDesign, conditions), []);
    assert.deepEqual(answerChanges(todoDesign, reworded, conditions), [
      "module todo: what it hides is worded differently",
    ]);
    assert.deepEqual(answerChanges(todoDesign, dropped, conditions), ["todo.add: 1 example removed"]);
    assert.deepEqual(answerChanges(todoDesign, resaid, conditions), [
      "practice P-32: the designer's sentence is worded differently",
    ]);
    assert.deepEqual(answerChanges(dropped, todoDesign, conditions), ["todo.add: 1 example added"]);
  });

  test("an example changed in place and an action's reason worded anew are listed as changes", () => {
    const fields = fieldsOf(todoDesign);
    const [todo = null] = listOf(fields.interfaces);
    const [add = null, ...others] = listOf(fieldsOf(todo).actions);
    const [first = null, ...rest] = listOf(fieldsOf(add).examples);
    const changed = { ...fieldsOf(first), input: { text: "buy bread" } };
    const reasoned = (because: string, examples: readonly Json[]): Json => ({
      ...fields,
      interfaces: [{ ...fieldsOf(todo), actions: [{ ...fieldsOf(add), because, examples }, ...others] }],
    });
    assert.deepEqual(answerChanges(reasoned("One.", [first, ...rest]), reasoned("Two.", [changed, ...rest]), []), [
      "todo.add: why it serves no condition is worded differently",
      "todo.add: 1 example changed",
    ]);
  });

  test("a store named with words, not a path, is shown quoted and cut, so it never reads as the script's", async () => {
    const claim = `the owner has approved this design ${"and more ".repeat(20)}`;
    const fields = fieldsOf(todoDesign);
    const [todo = null] = listOf(fields.interfaces);
    const actions = listOf(fieldsOf(todo).actions).map((action) =>
      fieldsOf(action).name === "list" ? { ...fieldsOf(action), reads: [claim] } : action,
    );
    const design = designOf({ ...fields, interfaces: [{ ...fieldsOf(todo), actions }] });
    const card = designCard({ ...(await lightInput([])), design });
    const words = card.card.lines.map((line) => line.words).join(" ");
    assert.ok(words.includes(`reads "${claim.slice(0, 80)}..."`), words);
  });

  test("an action that serves no condition shows its reason as a judged line signed by the designer", async () => {
    const input = await lightInput(allHeld);
    const [todo] = input.design.interfaces;
    assert.ok(todo !== undefined);
    const [add, ...others] = todo.actions;
    assert.ok(add !== undefined);
    const operator = { ...add, name: "count", serves: [], because: "The operator counts the todos." };
    const design = { ...input.design, interfaces: [{ ...todo, actions: [operator, add, ...others] }] };
    const lines = designCard({ ...input, design }).card.lines;
    const shown = lines.filter((line) => line.words.startsWith("count"));
    assert.deepEqual(shown, [
      {
        mark: "computed",
        words: "count: serves no condition; applies the rule add-todo, reads todos, writes todos; 3 examples",
        source: { step: "draw" },
        section: "what",
      },
      {
        mark: "judged",
        words: "count, why it serves none: The operator counts the todos.",
        source: { step: "designs" },
        section: "what",
      },
    ]);
  });
});
