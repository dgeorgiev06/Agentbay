import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { gateFrom, gateOf, modeNamePattern, type Gate, type Gated } from "../scripts/lib/gate.ts";
import { gateRanOf } from "../scripts/lib/gate-card.ts";
import { claimSentence, gateLine } from "../scripts/lib/gate-words.ts";
import { modeTestsOf, testsFromOf } from "../scripts/lib/gated-checks.ts";
import { listOf } from "../scripts/lib/json-values.ts";
import { drawn, type MergeCardInput } from "../scripts/lib/merge-card.ts";
import { gatesClaimed } from "../scripts/lib/plan-form.ts";
import { givenOf } from "../scripts/lib/plan-sources.ts";
import { provedOf, type Verdict } from "../scripts/lib/proof-answer.ts";
import { refusedSentences } from "../scripts/plan-checked.ts";
import { sliceOf } from "../scripts/lib/slice-form.ts";
import { gateShownOf, startCard } from "../scripts/lib/start-card.ts";
import { gatedFieldsNamed, withGateSaid, withGatedRuns, withoutGatedRuns } from "../scripts/lib/tool-checks.ts";
import { jsonOf } from "./kit-copy.ts";
import { plannedSlice } from "./wave-run.ts";

const kitFolder = join(import.meta.dirname, "../../../..");

function mode(name: string, scope: readonly string[]): Gated {
  return { name, kind: "mode", scope };
}

const todo: Gate = { gate: "mode", mode: "todo", folder: "components/modes/todo" };

const cases: readonly { readonly said: string; readonly slices: readonly Gated[]; readonly gate: Gate }[] = [
  { said: "one slice inside one mode's folder", slices: [mode("TD1", ["components/modes/todo/**"])], gate: todo },
  {
    said: "files and patterns all inside one mode's folder",
    slices: [mode("TD1", ["components/modes/todo/mode.yaml", "components/modes/todo/scripts/*.ts"])],
    gate: todo,
  },
  {
    said: "two slices of a wave inside the same mode's folder",
    slices: [mode("TD1", ["components/modes/todo/scripts/**"]), mode("TD2", ["components/modes/todo/tests/**"])],
    gate: todo,
  },
  {
    said: "a scope naming two modes",
    slices: [mode("TD1", ["components/modes/todo/**", "components/modes/notes/**"])],
    gate: {
      gate: "whole",
      because: { why: "several modes", folders: ["components/modes/notes", "components/modes/todo"] },
    },
  },
  {
    said: "a wave whose slices write in two modes",
    slices: [mode("TD1", ["components/modes/todo/**"]), mode("NT1", ["components/modes/notes/**"])],
    gate: {
      gate: "whole",
      because: { why: "several modes", folders: ["components/modes/notes", "components/modes/todo"] },
    },
  },
  {
    said: "a base mode, shared kit code",
    slices: [mode("TB", ["components/base/store/**"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TB", path: "components/base/store/**" } },
  },
  {
    said: "a path outside any mode, docs",
    slices: [mode("TD1", ["components/modes/todo/**", "docs/todo.md"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TD1", path: "docs/todo.md" } },
  },
  {
    said: "a path outside any mode, the kit's tests",
    slices: [mode("TD1", ["components/modes/todo/**", "tests/todo.test.ts"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TD1", path: "tests/todo.test.ts" } },
  },
  {
    said: "the folder of every mode",
    slices: [mode("TD1", ["components/modes/**"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TD1", path: "components/modes/**" } },
  },
  {
    said: "a mode's folder named by a pattern",
    slices: [mode("TD1", ["components/modes/to*/**"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TD1", path: "components/modes/to*/**" } },
  },
  {
    said: "the mode's folder itself, with nothing under it",
    slices: [mode("TD1", ["components/modes/todo"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TD1", path: "components/modes/todo" } },
  },
  {
    said: "a path that climbs out with ..",
    slices: [mode("TD1", ["components/modes/todo/../../base/store/**"])],
    gate: {
      gate: "whole",
      because: { why: "outside", slice: "TD1", path: "components/modes/todo/../../base/store/**" },
    },
  },
  {
    said: "an absolute path",
    slices: [mode("TD1", ["/components/modes/todo/**"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TD1", path: "/components/modes/todo/**" } },
  },
  {
    said: "a path that starts with ./",
    slices: [mode("TD1", ["./components/modes/todo/**"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TD1", path: "./components/modes/todo/**" } },
  },
  {
    said: "an empty scope",
    slices: [mode("TD1", [])],
    gate: { gate: "whole", because: { why: "no scope", slice: "TD1" } },
  },
  {
    said: "a wave mixing kinds",
    slices: [mode("TD1", ["components/modes/todo/**"]), { name: "TI", kind: "interface", scope: ["x/**"] }],
    gate: { gate: "whole", because: { why: "not a mode", slice: "TI", kind: "interface" } },
  },
  {
    said: "a capability inside a mode's folder",
    slices: [{ name: "TC", kind: "capability", scope: ["components/modes/todo/**"] }],
    gate: { gate: "whole", because: { why: "not a mode", slice: "TC", kind: "capability" } },
  },
  { said: "no slice at all", slices: [], gate: { gate: "whole", because: { why: "no slice" } } },
  {
    said: "an empty part in a path",
    slices: [mode("TD1", ["components/modes/todo//scripts/**"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TD1", path: "components/modes/todo//scripts/**" } },
  },
  {
    said: "a part that is a dot",
    slices: [mode("TD1", ["components/modes/todo/./scripts/**"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TD1", path: "components/modes/todo/./scripts/**" } },
  },
  {
    said: "a mode's name with a dot, which no manifest takes",
    slices: [mode("TD1", ["components/modes/to.do/**"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TD1", path: "components/modes/to.do/**" } },
  },
  {
    said: "a mode's name with an uppercase letter, which no manifest takes",
    slices: [mode("TD1", ["components/modes/Todo/**"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TD1", path: "components/modes/Todo/**" } },
  },
  {
    said: "the reserved name constructor",
    slices: [mode("TD1", ["components/modes/constructor/**"])],
    gate: { gate: "whole", because: { why: "outside", slice: "TD1", path: "components/modes/constructor/**" } },
  },
];

describe("the gate, by forge's rule from the slices' kinds and scopes", () => {
  for (const each of cases) {
    test(each.said, () => {
      assert.deepEqual(gateOf(each.slices), each.gate);
    });
  }

  test("a mode's name is what the manifest's own schema allows, by the same pattern", async () => {
    const schema = jsonOf(await readFile(join(kitFolder, "schemas/mode.schema.json"), "utf8"));
    const name = fieldsOf(fieldsOf(fieldsOf(schema).$defs ?? null).name ?? null);
    assert.equal(modeNamePattern.source, name.pattern);
  });

  test("a gate handed on as data reads back as itself, and one not in the form of mode reads as whole", () => {
    for (const each of cases) {
      assert.deepEqual(gateFrom(jsonOf(JSON.stringify(each.gate))), each.gate);
    }
    const forged = { gate: "mode", mode: "todo", folder: "components" };
    assert.equal(gateFrom(forged).gate, "whole");
    assert.equal(gateFrom({ gate: "mode", mode: "../base", folder: "components/modes/../base" }).gate, "whole");
    assert.equal(gateFrom(null).gate, "whole");
  });
});

describe("the gate's words", () => {
  test("the mode gate says what runs and why before the build, and after it what proof says ran", () => {
    assert.equal(
      gateLine(todo, ["TD1", "TD2"], "before"),
      "gate: the mode's own tests and the fast checks of the whole project, since every slice writes only inside " +
        "components/modes/todo; the other tests are not run",
    );
    assert.equal(
      gateLine(todo, ["TD1"], "chosen"),
      "gate: the mode's own tests and the fast checks of the whole project ran, since TD1 writes only inside " +
        "components/modes/todo; the other tests were not run",
    );
    assert.equal(
      gateLine(todo, ["TD1"], "no own test"),
      "gate: the mode gate, since TD1 writes only inside components/modes/todo; the mode has no test file of its " +
        "own, so the checks item is not known",
    );
    assert.equal(
      gateLine(todo, ["TD1"], "every test"),
      "gate: the mode gate was asked for, since TD1 writes only inside components/modes/todo, but proof's answer " +
        "says it ran every test",
    );
  });

  test("the whole gate says why, for each reason", () => {
    const why = (slices: readonly Gated[]): string => gateLine(gateOf(slices), ["TB"], "chosen");
    assert.equal(
      why([mode("TB", ["components/base/store/**"])]),
      "gate: the whole test run, since TB writes outside a mode's folder (components/base/store/**)",
    );
    assert.equal(
      why([{ name: "TB", kind: "interface", scope: ["x/**"] }]),
      "gate: the whole test run, since TB is of kind interface, not mode",
    );
    assert.equal(
      why([mode("TB", ["components/modes/a/**", "components/modes/b/**"])]),
      "gate: the whole test run, since the slices write inside more than one mode's folder " +
        "(components/modes/a and components/modes/b)",
    );
  });

  test("what ran is read from proof's answer, not from what forge asked", () => {
    const checks = (detail: string): Verdict => ({ item: "c", kind: "checks", verdict: "passed", detail });
    assert.equal(
      gateRanOf([
        checks("Every check passed (lint), and so did the run of the 2 test files chosen from testsFrom: 3 tests."),
      ]),
      "chosen",
    );
    assert.equal(gateRanOf([checks("Every check passed (lint), and so did the test run: 900 tests.")]), "every test");
    assert.equal(gateRanOf([checks("It held.")]), "not said");
    assert.equal(gateRanOf([]), "not said");
    const none =
      "The test run could not start: None of the 1 file in testsFrom is a test file by the toolchain's patterns.";
    assert.equal(gateRanOf([{ item: "c", kind: "checks", verdict: "inconclusive", reason: none }]), "no own test");
  });
});

function checksSlice(name: string, scope: readonly string[]): Json {
  const checks = { id: `DOD-${name}-2`, says: "The checks pass.", level: "must", proof: { kind: "checks" } };
  return { name, kind: "mode", scope: [...scope], after: [], done: [checks] };
}

function proofOfItem(slice: Json): Json {
  return fieldsOf(listOf(fieldsOf(slice).done)[0] ?? null).proof ?? null;
}

describe("the checks items as the gate plans them", () => {
  test("under the whole gate the slice is as the plan wrote it, and any testsFrom or bayCheck is taken out", () => {
    const slice = checksSlice("TB", ["components/base/store/**"]);
    assert.deepEqual(withGateSaid(slice, gateOf([sliceOf(slice)])), slice);
    const claiming = withGatedRuns(slice, ["components/base/store/tests/a.test.ts"]);
    assert.deepEqual(proofOfItem(withoutGatedRuns(claiming)), { kind: "checks" });
  });

  test("the mode's test files are those anywhere in its folder that the toolchain's patterns hold", () => {
    const listed = [
      "components/modes/todo/mode.yaml",
      "components/modes/todo/scripts/x.test.ts",
      "components/modes/todo/scripts/x.ts",
      "components/modes/todo/tests/fixture.json",
      "components/modes/todo/tests/todo.test.ts",
    ];
    assert.deepEqual(modeTestsOf(listed, ["**/*.test.ts"]), [
      "components/modes/todo/scripts/x.test.ts",
      "components/modes/todo/tests/todo.test.ts",
    ]);
    assert.deepEqual(modeTestsOf(listed, []), []);
  });

  test("under the mode gate the checks item says which checks run, runs bay check, and takes the mode's tests and the setting's", () => {
    const slice = checksSlice("TD1", ["components/modes/todo/**"]);
    const said = withGateSaid(slice, todo);
    assert.equal(
      sliceOf(said).done[0]?.says,
      "The toolchain's checks of the whole project, bay check on the head and the mode gate's tests, those under " +
        "components/modes/todo and those the setting modeGateTests adds, pass; the project's other tests are not run.",
    );
    const own = ["components/modes/todo/scripts/x.test.ts"];
    const testsFrom = testsFromOf(todo, own, ["tests/kit-check.test.ts"]);
    assert.deepEqual(testsFrom, [...own, "tests/kit-check.test.ts"]);
    assert.deepEqual(proofOfItem(withGatedRuns(said, testsFrom)), { kind: "checks", testsFrom, bayCheck: true });
  });

  test("a mode with no test file of its own asks for its folder alone, whatever the setting adds, so proof runs no test", () => {
    assert.deepEqual(testsFromOf(todo, [], ["tests/kit-check.test.ts"]), ["components/modes/todo"]);
  });

  test("more files than proof takes is refused, never cut", () => {
    const many = Array.from({ length: 201 }, (_, at) => `components/modes/todo/tests/t${String(at)}.test.ts`);
    assert.throws(() => testsFromOf(todo, many, []), /more than 200 test files/);
    assert.throws(() => testsFromOf(todo, many.slice(0, 200), ["tests/kit-check.test.ts"]), /more than 200 test files/);
  });
});

describe("a plan or a request cannot choose the gate", () => {
  function claiming(proof: Json): Json {
    const item = { id: "DOD-TD1-2", says: "The checks pass.", level: "must", proof };
    return { ...fieldsOf(checksSlice("TD1", ["components/modes/todo/**"])), done: [item] };
  }

  test("a checks item that names testsFrom, even as null, or bayCheck, is named", () => {
    assert.deepEqual(gatedFieldsNamed(claiming({ kind: "checks", testsFrom: ["a.test.ts"] })), ["DOD-TD1-2"]);
    assert.deepEqual(gatedFieldsNamed(claiming({ kind: "checks", testsFrom: null })), ["DOD-TD1-2"]);
    assert.deepEqual(gatedFieldsNamed(claiming({ kind: "checks", bayCheck: true })), ["DOD-TD1-2"]);
    assert.deepEqual(gatedFieldsNamed(claiming({ kind: "checks" })), []);
  });

  test("a plan is refused at the claiming slice, by the plan reading and by the planner's check", () => {
    const plan = {
      title: "A plan",
      slices: [plannedSlice("TD9"), { title: "Claims", slice: claiming({ kind: "checks", testsFrom: ["a.test.ts"] }) }],
    };
    const sentence = claimSentence("TD1", ["DOD-TD1-2"]);
    assert.deepEqual(gatesClaimed(plan), [{ at: "/slices/1/slice/done", sentence }]);
    assert.ok(refusedSentences(plan, givenOf(null)).includes(sentence));
    assert.ok(!refusedSentences({ title: "A plan", slices: [plannedSlice("TD9")] }, givenOf(null)).includes(sentence));
    assert.equal(
      sentence,
      "Slice TD1's checks item DOD-TD1-2 names testsFrom or bayCheck, which forge alone sets, deciding the gate from " +
        "the slices' kinds and scopes; leave them out.",
    );
  });
});

function mergeInput(slice: Json, verdicts: readonly Json[]): MergeCardInput {
  const form = sliceOf(slice);
  return {
    slice: form,
    proof: provedOf({ verdicts: [...verdicts], judgement: [], size: [] }),
    built: { outcome: "built" },
    builtAt: "build",
    work: "forge/wip/TD1/1",
    kept: "set-aside",
    caseMessages: "unfiltered",
    into: "integration",
    gate: gateShownOf(gateOf([form]), ["tests/kit-check.test.ts"]),
  };
}

const checksPassedVerdict = {
  item: "DOD-TD1-2",
  kind: "checks",
  verdict: "passed",
  detail:
    "Every check passed (typecheck, lint), and so did the run of the 2 test files chosen from testsFrom: 9 tests. " +
    "bay check on the head found no error.",
};

const scopePassed = { item: "scope", kind: "in-scope", verdict: "passed", detail: "It held." };

function wordsOf(input: MergeCardInput): readonly string[] {
  return drawn(input).card.lines.map((line) => line.words);
}

const modeSlice = withGateSaid(checksSlice("TD1", ["components/modes/todo/**"]), todo);

describe("the cards say which gate", () => {
  test("the slice's start card names the mode gate and what it runs, bay check among them", () => {
    const card = startCard({
      slice: sliceOf(modeSlice),
      title: "Todo",
      base: "875d936",
      bugs: [],
      planter: "none",
      interface: "not asked",
      gate: gateShownOf(todo, []),
    });
    const words = card.lines.map((line) => line.words);
    assert.ok(words.includes(gateLine(todo, ["TD1"], "before")), words.join("\n"));
    assert.ok(
      words.includes(
        "the mode gate: every test file under components/modes/todo at the head, the toolchain's checks of the whole " +
          "project, bay check on the head; the setting modeGateTests adds no test",
      ),
      words.join("\n"),
    );
  });

  test("the merge card under the mode gate says it ran, what ran, bay check's finding, and never that the project's checks pass", () => {
    const input = mergeInput(modeSlice, [checksPassedVerdict, scopePassed]);
    const words = wordsOf(input);
    assert.ok(words.includes(gateLine(todo, ["TD1"], "chosen")), words.join("\n"));
    assert.ok(words.includes("bay check on the head found no error"), words.join("\n"));
    assert.ok(words.includes("tests passed: 9, in 2 test files chosen by the gate"), words.join("\n"));
    assert.ok(
      words.includes(
        "the mode gate: every test file under components/modes/todo at the head, the toolchain's checks of the whole " +
          "project, bay check on the head, and tests/kit-check.test.ts, which the setting modeGateTests adds",
      ),
      words.join("\n"),
    );
    assert.ok(!words.join(" ").includes("The checks pass"), words.join("\n"));
    assert.equal(drawn(input).merge, true);
  });

  test("a mode with no test file of its own: the checks item is not known, merge is withheld, and the card says why", () => {
    const reason =
      "The test run could not start: None of the 1 file in testsFrom is a test file by the toolchain's patterns.";
    const notKnown = { item: "DOD-TD1-2", kind: "checks", verdict: "inconclusive", reason };
    const input = mergeInput(modeSlice, [notKnown, scopePassed]);
    assert.ok(wordsOf(input).includes(gateLine(todo, ["TD1"], "no own test")), wordsOf(input).join("\n"));
    assert.equal(drawn(input).merge, false);
  });

  test("bay check that found errors fails the checks item and the card says how many", () => {
    const failed = {
      item: "DOD-TD1-2",
      kind: "checks",
      verdict: "failed",
      detail: "bay check on the head found 2 errors.",
    };
    const input = mergeInput(modeSlice, [failed, scopePassed]);
    assert.ok(wordsOf(input).includes("why: bay check on the head found 2 errors"), wordsOf(input).join("\n"));
    assert.equal(drawn(input).merge, false);
  });

  test("a proof that ran every test under the mode gate is said so, never that the other tests were not run", () => {
    const whole = { ...checksPassedVerdict, detail: "Every check passed (lint), and so did the test run: 900 tests." };
    const words = wordsOf(mergeInput(modeSlice, [whole, scopePassed]));
    assert.ok(words.includes(gateLine(todo, ["TD1"], "every test")), words.join("\n"));
    assert.ok(!words.some((line) => line.includes("were not run")), words.join("\n"));
  });

  test("the merge card under the whole gate says why and keeps the plan's sentence", () => {
    const slice = checksSlice("TB", ["components/base/store/**"]);
    const whole = {
      ...checksPassedVerdict,
      item: "DOD-TB-2",
      detail: "Every check passed (lint), and so did the test run: 900 tests.",
    };
    const words = wordsOf(mergeInput(slice, [whole, scopePassed]));
    assert.ok(
      words.includes("gate: the whole test run, since TB writes outside a mode's folder (components/base/store/**)"),
      words.join("\n"),
    );
    assert.ok(words.includes("DOD-TB-2, must, passed: The checks pass."), words.join("\n"));
    assert.ok(words.includes("tests passed: 900"), words.join("\n"));
  });

  test("under the mode gate, scope not passed, or not given, withholds merge and says the gate does not stand", () => {
    const failedScope = { item: "scope", kind: "in-scope", verdict: "failed", detail: "docs/x.md is outside." };
    for (const verdicts of [[checksPassedVerdict, failedScope], [checksPassedVerdict]]) {
      const input = mergeInput(modeSlice, verdicts);
      assert.equal(drawn(input).merge, false);
      assert.match(drawn(input).card.withheld.merge ?? "", /the mode gate stands only on scope passed/i);
      assert.ok(wordsOf(input).includes("the mode gate stands only on scope passed, and scope did not pass"));
    }
  });
});
