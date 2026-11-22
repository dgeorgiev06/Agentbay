import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { gateFrom, gateOf, type Gate, type Gated } from "../scripts/lib/gate.ts";
import { claimSentence, gateLine } from "../scripts/lib/gate-words.ts";
import { testsFromOf } from "../scripts/lib/gated-checks.ts";
import { listOf } from "../scripts/lib/json-values.ts";
import { drawn, type MergeCardInput } from "../scripts/lib/merge-card.ts";
import { gatesClaimed } from "../scripts/lib/plan-form.ts";
import { provedOf } from "../scripts/lib/proof-answer.ts";
import { sliceOf } from "../scripts/lib/slice-form.ts";
import { startCard } from "../scripts/lib/start-card.ts";
import { testsFromNamed, withGateSaid, withTestsFrom } from "../scripts/lib/tool-checks.ts";
import { jsonOf } from "./kit-copy.ts";
import { plannedSlice } from "./wave-run.ts";

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
];

describe("the gate, by forge's rule from the slices' kinds and scopes", () => {
  for (const each of cases) {
    test(each.said, () => {
      assert.deepEqual(gateOf(each.slices), each.gate);
    });
  }

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
  test("the mode gate says what runs and why, before the build and after it", () => {
    assert.equal(
      gateLine(todo, ["TD1", "TD2"], "before"),
      "gate: the mode's own tests and the fast checks of the whole project, since every slice writes only inside " +
        "components/modes/todo; the other tests are not run",
    );
    assert.equal(
      gateLine(todo, ["TD1"], "after"),
      "gate: the mode's own tests and the fast checks of the whole project ran, since TD1 writes only inside " +
        "components/modes/todo; the other tests were not run",
    );
  });

  test("the whole gate says why, for each reason", () => {
    const why = (slices: readonly Gated[]): string => gateLine(gateOf(slices), ["TB"], "after");
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
});

function checksSlice(name: string, scope: readonly string[]): Json {
  const checks = { id: `DOD-${name}-2`, says: "The checks pass.", level: "must", proof: { kind: "checks" } };
  return { name, kind: "mode", scope: [...scope], after: [], done: [checks] };
}

function proofOfItem(slice: Json): Json {
  return fieldsOf(listOf(fieldsOf(slice).done)[0] ?? null).proof ?? null;
}

describe("the checks items as the gate plans them", () => {
  test("under the whole gate the slice is as the plan wrote it", () => {
    const slice = checksSlice("TB", ["components/base/store/**"]);
    assert.deepEqual(withGateSaid(slice, gateOf([sliceOf(slice)])), slice);
  });

  test("under the mode gate the checks item says which checks run, and takes its tests from the listed files", () => {
    const slice = checksSlice("TD1", ["components/modes/todo/**"]);
    const said = withGateSaid(slice, todo);
    assert.equal(
      sliceOf(said).done[0]?.says,
      "The toolchain's checks of the whole project and the mode gate's tests, those under " +
        "components/modes/todo/tests and those the setting modeGateTests names, pass; the project's other tests " +
        "are not run.",
    );
    const listed = ["components/modes/todo/tests/todo.test.ts", "components/modes/todo/tests/fixture.json"];
    const testsFrom = testsFromOf(todo, listed, ["tests/kit-check.test.ts"]);
    assert.deepEqual(testsFrom, [...listed, "tests/kit-check.test.ts"]);
    assert.deepEqual(proofOfItem(withTestsFrom(said, testsFrom)), { kind: "checks", testsFrom });
  });

  test("a mode with no file under its tests folder asks for the folder, which proof finds no test in", () => {
    assert.deepEqual(testsFromOf(todo, [], []), ["components/modes/todo/tests"]);
  });

  test("more files than proof takes is refused, never cut", () => {
    const many = Array.from({ length: 201 }, (_, at) => `components/modes/todo/tests/t${String(at)}.test.ts`);
    assert.throws(() => testsFromOf(todo, many, []), /more than 200 files/);
    assert.throws(() => testsFromOf(todo, many.slice(0, 200), ["tests/kit-check.test.ts"]), /more than 200 files/);
  });
});

describe("a plan or a request cannot choose the gate", () => {
  const claiming = {
    ...fieldsOf(checksSlice("TD1", ["components/modes/todo/**"])),
    done: [
      {
        id: "DOD-TD1-2",
        says: "The checks pass.",
        level: "must",
        proof: { kind: "checks", testsFrom: ["components/modes/todo/tests/todo.test.ts"] },
      },
    ],
  };

  test("a checks item that names testsFrom is named, and the plan is refused at it", () => {
    assert.deepEqual(testsFromNamed(claiming), ["DOD-TD1-2"]);
    const plan = { title: "A plan", slices: [plannedSlice("TD9"), { title: "Claims", slice: claiming }] };
    assert.deepEqual(gatesClaimed(plan), [
      { at: "/slices/1/slice/done", sentence: claimSentence("TD1", ["DOD-TD1-2"]) },
    ]);
    assert.equal(
      claimSentence("TD1", ["DOD-TD1-2"]),
      "Slice TD1's checks item DOD-TD1-2 names testsFrom, which forge alone sets, deciding the gate from the " +
        "slices' kinds and scopes; leave testsFrom out.",
    );
  });

  test("a slice's form has no other place a gate could be written", () => {
    assert.deepEqual(gatesClaimed({ title: "A plan", slices: [plannedSlice("TD9")] }), []);
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
    gate: { gate: gateOf([form]), alsoRun: ["tests/kit-check.test.ts"] },
  };
}

const checksPassedVerdict = {
  item: "DOD-TD1-2",
  kind: "checks",
  verdict: "passed",
  detail:
    "Every check passed (typecheck, lint), and so did the run of the 2 test files chosen from testsFrom: 9 tests.",
};

const scopePassed = { item: "scope", kind: "in-scope", verdict: "passed", detail: "It held." };

function wordsOf(input: MergeCardInput): readonly string[] {
  return drawn(input).card.lines.map((line) => line.words);
}

describe("the cards say which gate", () => {
  test("the slice's start card names the mode gate under its checks item", () => {
    const slice = sliceOf(withGateSaid(checksSlice("TD1", ["components/modes/todo/**"]), todo));
    const card = startCard({
      slice,
      title: "Todo",
      base: "875d936",
      bugs: [],
      planter: "none",
      interface: "not asked",
      gate: { gate: todo, alsoRun: [] },
    });
    const words = card.lines.map((line) => line.words);
    assert.ok(words.includes(gateLine(todo, ["TD1"], "before")), words.join("\n"));
    assert.ok(
      words.includes(
        "the mode gate: every test file under components/modes/todo/tests at the head and the toolchain's checks " +
          "of the whole project; the setting modeGateTests names no other test",
      ),
      words.join("\n"),
    );
  });

  test("the merge card under the mode gate says it ran, what ran, and never that the project's checks pass", () => {
    const slice = withGateSaid(checksSlice("TD1", ["components/modes/todo/**"]), todo);
    const input = mergeInput(slice, [checksPassedVerdict, scopePassed]);
    const words = wordsOf(input);
    assert.ok(words.includes(gateLine(todo, ["TD1"], "after")), words.join("\n"));
    assert.ok(words.includes("tests passed: 9, in 2 test files chosen by the gate"), words.join("\n"));
    assert.ok(
      words.includes(
        "the mode gate: every test file under components/modes/todo/tests at the head, the toolchain's checks of " +
          "the whole project, and tests/kit-check.test.ts, the setting modeGateTests",
      ),
      words.join("\n"),
    );
    assert.ok(!words.join(" ").includes("The checks pass"), words.join("\n"));
    assert.equal(drawn(input).merge, true);
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
    const slice = withGateSaid(checksSlice("TD1", ["components/modes/todo/**"]), todo);
    const failedScope = { item: "scope", kind: "in-scope", verdict: "failed", detail: "docs/x.md is outside." };
    for (const verdicts of [[checksPassedVerdict, failedScope], [checksPassedVerdict]]) {
      const input = mergeInput(slice, verdicts);
      assert.equal(drawn(input).merge, false);
      assert.match(drawn(input).card.withheld.merge ?? "", /the mode gate stands only on scope passed/i);
      assert.ok(wordsOf(input).includes("the mode gate stands only on scope passed, and scope did not pass"));
    }
  });
});
