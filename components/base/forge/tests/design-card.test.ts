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
import type { Practice } from "../scripts/lib/practices.ts";
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

const askedPractices: readonly Practice[] = [
  { id: "P-52", says: "The rules of the work are pure functions. Reading and writing happen around them." },
  { id: "P-32", says: "A skill step names its role." },
  { id: "P-35", says: "Interfaces first. Before a plan is cut, the design names each module touched." },
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

type Kind = { readonly section: string; readonly mark: string; readonly step: string };

function by(section: string, mark: string, step: string): Kind {
  return { section, mark, step };
}

function plain(kind: Kind, words: string): Fact {
  return { section: kind.section, short: false, about: "", mark: kind.mark, step: kind.step, words };
}

function short(kind: Kind, words: string): Fact {
  return { ...plain(kind, words), short: true };
}

function about(named: string, kind: Kind, words: string): Fact {
  return { ...plain(kind, words), about: named };
}

function factsOfCard(drawn: DesignCard): readonly Fact[] {
  return drawn.card.lines.map((line) => factOf({ ...line }));
}

const lightFacts: readonly Fact[] = [
  short(by("what", "computed", "draw"), "1 module, 4 actions: add, list, done and remove."),
  short(by("what", "computed", "draw"), "Meets all 13 of your conditions."),
  plain(by("what", "computed", "draw"), "This is the one design written, on the light path."),
  plain(by("what", "computed", "draw"), "Your requirements: docs/requirements/todo.yaml, 2 outcomes, 13 conditions."),
  about("module todo", by("what", "computed", "draw"), "It implements todo and owns the table todos."),
  about(
    "module todo",
    by("what", "judged", "designs"),
    "Hides: How todos are kept, numbered and never given a removed id again.",
  ),
  about(
    "rule add-todo, in module todo",
    by("what", "computed", "draw"),
    "Takes request and todos (from todos); gives todos (into todos) and answer.",
  ),
  about(
    "rule add-todo, in module todo",
    by("what", "judged", "designs"),
    "Decides: Whether a text may be added, and the id the new todo gets.",
  ),
  about(
    "rule mark-done, in module todo",
    by("what", "computed", "draw"),
    "Takes request and todos (from todos); gives todos (into todos) and answer.",
  ),
  about(
    "rule mark-done, in module todo",
    by("what", "judged", "designs"),
    "Decides: Whether a todo may be marked done.",
  ),
  about(
    "rule remove-todo, in module todo",
    by("what", "computed", "draw"),
    "Takes request and todos (from todos); gives todos (into todos) and answer.",
  ),
  about("rule remove-todo, in module todo", by("what", "judged", "designs"), "Decides: Whether a todo may be removed."),
  about("interface todo", by("what", "computed", "draw"), "4 actions, 8 schema files."),
  about(
    "action add",
    by("what", "computed", "draw"),
    "Meets 6 of your conditions (O1-C1, O1-C4, O1-C5, O1-C6, O1-C7 and O2-C4). Applies the rule add-todo; reads todos; writes todos. 3 worked examples.",
  ),
  about(
    "action list",
    by("what", "computed", "draw"),
    "Meets 6 of your conditions (O1-C1, O1-C2, O1-C3, O2-C1, O2-C2 and O2-C3). Applies no rule; reads todos; writes nothing. 2 worked examples.",
  ),
  about(
    "action done",
    by("what", "computed", "draw"),
    "Meets 4 of your conditions (O2-C1, O2-C2, O2-C5 and O2-C6). Applies the rule mark-done; reads todos; writes todos. 3 worked examples.",
  ),
  about(
    "action remove",
    by("what", "computed", "draw"),
    "Meets 3 of your conditions (O2-C3, O2-C4 and O2-C5). Applies the rule remove-todo; reads todos; writes todos. 2 worked examples.",
  ),
  plain(by("what", "computed", "draw"), "One design was written, so none was compared."),
  short(by("checks", "computed", "draw"), `${String(checksRun)} automatic checks: no problem found.`),
  short(
    by("checks", "computed", "draw"),
    "A review by a model: 0 findings; 2 of the 3 practices it judged are held, and 1 does not apply.",
  ),
  plain(
    by("checks", "computed", "draw"),
    "10 worked examples checked against their actions' schemas, but not the input of the 4 refusals.",
  ),
  about(
    "practices a script checks",
    by("checks", "computed", "draw"),
    "Every module implements an interface, and every interface is defined and implemented (P-35).",
  ),
  about(
    "practices a script checks",
    by("checks", "computed", "draw"),
    "No module or interface has a vague name such as utils or helpers (P-36).",
  ),
  about(
    "practices a script checks",
    by("checks", "computed", "draw"),
    "Each table or file a module owns has that one owner (P-38).",
  ),
  about("practices a script checks", by("checks", "computed", "draw"), "No table is owned by two modules (P-42)."),
  about(
    "practices the review step judged",
    by("checks", "computed", "draw"),
    "The rules of the work are pure functions (P-52): held.",
  ),
  about(
    "practices the review step judged",
    by("checks", "computed", "draw"),
    "A skill step names its role (P-32): does not apply.",
  ),
  about("practices the review step judged", by("checks", "computed", "draw"), "Interfaces first (P-35): held."),
  plain(
    by("checks", "computed", "draw"),
    "The designer was asked once; a second answer is asked only when the review step answers a practice not held or gives a finding.",
  ),
  about("findings of the review step", by("checks", "computed", "draw"), "No findings."),
];

function factsIn(drawn: DesignCard, section: string): readonly Fact[] {
  return factsOfCard(drawn).filter((fact) => fact.section === section);
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
    asked: askedPractices,
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

  test("the design card on the light path, every practice held, hands these facts, in this order, and offers approve", async () => {
    const drawn = designCard(await lightInput(allHeld));
    assert.deepEqual(factsOfCard(drawn), lightFacts);
    assert.deepEqual(drawn.offered, { approve: true });
    assert.deepEqual(drawn.card.withheld, {});
    assert.equal(drawn.card.title, "Commit the design of todo?");
  });

  test("a problem the check found comes first, says so in the checks' count, and withholds approve", async () => {
    const drawn = designCard({ ...(await lightInput(allHeld)), problems: ["The action x has no example."] });
    assert.deepEqual(drawn.offered, { approve: false });
    assert.deepEqual(drawn.card.withheld, { approve: "The design check found 1 problem." });
    assert.deepEqual(
      factsOfCard(drawn)[0],
      plain(by("problems", "computed", "draw"), "A check found: The action x has no example."),
    );
    assert.equal(shortWords(drawn, "checks")[0], `${String(checksRun)} automatic checks: 1 problem found.`);
    const two = designCard({ ...(await lightInput(allHeld)), problems: ["One.", "Two."] });
    assert.equal(shortWords(two, "checks")[0], `${String(checksRun)} automatic checks: 2 problems found.`);
  });

  test("a condition no action meets is counted and named", async () => {
    const input = await lightInput(allHeld);
    const [todo] = input.design.interfaces;
    assert.ok(todo !== undefined);
    const actions = todo.actions.filter((action) => action.name !== "remove" && action.name !== "done");
    const design = { ...input.design, interfaces: [{ ...todo, actions }] };
    assert.deepEqual(shortWords(designCard({ ...input, design }), "what"), [
      "1 module, 2 actions: add and list.",
      "Leaves 2 of your 13 conditions unmet (O2-C5 and O2-C6).",
    ]);
  });

  test("a branch that stayed is said in what it is, with the reason forge was given", async () => {
    const stayed = [{ branch: "forge/todo-design", reason: "a worktree still holds it" }];
    const drawn = designCard({ ...(await lightInput(allHeld)), stayed });
    assert.deepEqual(
      factsIn(drawn, "what").at(-1),
      plain(by("what", "computed", "draw"), "forge/todo-design stayed: a worktree still holds it"),
    );
  });

  test("a practice held by design that the review step answered not held is a problem, with its reason, and withholds approve", async () => {
    const drawn = designCard(await lightInput(p52NotHeld));
    assert.deepEqual(drawn.offered, { approve: false });
    assert.deepEqual(drawn.card.withheld, {
      approve: "The challenger answered P-52 not held, and a practice held by design must be held.",
    });
    assert.deepEqual(factsIn(drawn, "problems"), [
      about(
        "practice P-52",
        by("problems", "computed", "draw"),
        "The review step answered not held: The rules of the work are pure functions (P-52).",
      ),
      about(
        "practice P-52",
        by("problems", "judged", "challenge"),
        "Its reason: The add action decides the next id and writes it in one script.",
      ),
    ]);
    assert.equal(
      shortWords(drawn, "checks")[1],
      "A review by a model: 0 findings; 1 of the 3 practices it judged is not held.",
    );
  });

  test("after a second pass that holds every practice, the checks say what the first review found, that the designer answered once and what changed, and approve is offered", async () => {
    const drawn = designCard({ ...(await lightInput(allHeld)), second: answeredP52 });
    assert.deepEqual(drawn.offered, { approve: true });
    const checks = factsIn(drawn, "checks");
    const first = checks.findIndex((fact) => fact.words.startsWith("The first review"));
    assert.deepEqual(checks.slice(first, first + 6), [
      plain(
        by("checks", "computed", "draw"),
        "The first review answered P-52 not held and gave 1 finding; the designer answered once.",
      ),
      about("what the designer's answer changed", by("checks", "computed", "draw"), "2 changes, found by a script."),
      ...answeredP52.changes.map((change) =>
        about("what the designer's answer changed", by("checks", "computed", "draw"), change),
      ),
      plain(by("checks", "computed", "draw"), "The second review's answers decide this approval."),
      about("findings left after the answer", by("checks", "computed", "draw"), "No findings."),
    ]);
    assert.ok(
      factsIn(drawn, "what").some(
        (fact) =>
          fact.words ===
          "This is the one design written, on the light path, answered once by its designer after the first review.",
      ),
    );
  });

  test("after a second pass that leaves a practice not held, the second review's reason and the designer's answer are the problem, the finding left is a check, and only stop is offered", async () => {
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
      factsIn(drawn, "problems").map((fact) => [fact.mark, fact.step, fact.words]),
      [
        ["computed", "draw", "The review step answered not held: The rules of the work are pure functions (P-52)."],
        ["judged", "challenge-again", `Its reason: ${stillNotHeld[0]?.sentence ?? ""}`],
        [
          "judged",
          "design-again",
          "The designer answered: The module todo-rules decides the next id; todo reads and writes around it.",
        ],
      ],
    );
    const finding = factsIn(drawn, "checks").find((fact) => fact.words.startsWith("In todo.add:"));
    assert.deepEqual([finding?.mark, finding?.step, finding?.short], ["judged", "challenge-again", false]);
    assert.equal(
      shortWords(drawn, "checks")[1],
      "A review by a model: 1 finding; 1 of the 3 practices it judged is not held.",
    );
  });

  test("a finding with every practice held is shown as judged by the challenger and withholds nothing, as on the plan card", async () => {
    const drawn = designCard({ ...(await lightInput(allHeld)), findings: [refusalExample] });
    assert.deepEqual(drawn.offered, { approve: true });
    const finding = drawn.card.lines.find((line) => line.words.startsWith("In todo.add:"));
    assert.deepEqual([finding?.mark, finding?.source], ["judged", { step: "challenge" }]);
  });

  test("the examples' line says each was checked when none ends in a refusal, and names every check not made", async () => {
    const input = await lightInput(allHeld);
    const examplesLine = (drawn: DesignCardInput): string | undefined =>
      designCard(drawn).card.lines.find((line) => line.words.includes("worked examples checked"))?.words;
    const [todo] = input.design.interfaces;
    assert.ok(todo !== undefined);
    const answered = todo.actions.map((action) => ({
      ...action,
      examples: action.examples.filter((example) => "answer" in example.told),
    }));
    const noRefusal = { ...input.design, interfaces: [{ ...todo, actions: answered }] };
    assert.equal(
      examplesLine({ ...input, design: noRefusal }),
      "6 worked examples checked against their actions' schemas.",
    );
    assert.equal(
      examplesLine({ ...input, design: noRefusal, refusedSchemas: 1 }),
      "6 worked examples checked against their actions' schemas, but not against the 1 schema the kernel refused.",
    );
    assert.equal(
      examplesLine({ ...input, refusedSchemas: 2 }),
      "10 worked examples checked against their actions' schemas, but not the input of the 4 refusals and against " +
        "the 2 schemas the kernel refused.",
    );
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
    const hides = factsIn(drawn, "what").find((fact) => fact.words === `Hides: ${todoHides}`);
    assert.deepEqual([hides?.mark, hides?.step, hides?.about], ["judged", "challenge", "module todo"]);
    const what = factsIn(drawn, "what");
    assert.ok(
      what.some((fact) => fact.words === "This is a design the review step merged from two written apart."),
      JSON.stringify(what),
    );
    const differed = "where the two designs differed";
    assert.deepEqual(what.slice(-4), [
      about(differed, by("what", "computed", "draw"), "2 differences, found by a script."),
      about(differed, by("what", "computed", "draw"), "module store: only in the second design"),
      about(differed, by("what", "computed", "draw"), "module todo: implements or owns differ"),
      about(
        differed,
        by("what", "judged", "challenge"),
        "Why this design was chosen: The second keeps the table apart.",
      ),
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
    const shown = factsIn(designCard({ ...input, design }), "what").filter((fact) => fact.about === "action count");
    assert.deepEqual(shown, [
      about(
        "action count",
        by("what", "computed", "draw"),
        "Meets none of your conditions. Applies the rule add-todo; reads todos; writes todos. 3 worked examples.",
      ),
      about("action count", by("what", "judged", "designs"), "Why it meets none: The operator counts the todos."),
    ]);
  });
});
