import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shortHash } from "../../../../bay/sdk.ts";
import { interfaceChanges, interfaceClauses, interfaceWords, pinnedOf } from "../scripts/lib/interface-pins.ts";
import { drawn, type MergeCardInput } from "../scripts/lib/merge-card.ts";
import type { RoundsOnCard } from "../scripts/lib/round-card.ts";

const schema = "components/base/interfaces/quill/count-request.json";

const manifest = "components/base/interfaces/quill.yaml";

const one = "1111111111111111";

const two = "2222222222222222";

const other = "9999999999999999";

function mergeInput(changes: Partial<MergeCardInput>): MergeCardInput {
  return {
    slice: { name: "Q1", kind: "mode", scope: ["components/modes/q1/**"], after: [], done: [] },
    proof: {
      verdicts: [
        { item: "scope", kind: "in-scope", verdict: "passed", detail: "In scope." },
        { item: "declared", kind: "as-declared", verdict: "passed", detail: "As declared." },
      ],
      size: [],
    },
    built: { outcome: "built" },
    builtAt: "round-1",
    work: "forge/Q1-tests-1",
    kept: "with-tests",
    caseMessages: "filtered",
    into: "integration",
    ...changes,
  };
}

function wordsOf(input: MergeCardInput): readonly string[] {
  return drawn(input).card.lines.map((line) => line.words.replaceAll("/ ", "/"));
}

describe("an interface file's hash", () => {
  test("is the toolbox's short hash of the file's text; other text has another, and a file not there has none", () => {
    const pinned = pinnedOf(schema, '{ "type": "object" }');
    assert.deepEqual(pinned, { path: schema, hash: shortHash('{ "type": "object" }') });
    assert.match(shortHash('{ "type": "object" }'), /^[0-9a-f]{16}$/);
    assert.notEqual(pinnedOf(schema, '{ "type": "array" }').hash, pinned.hash);
    assert.deepEqual(pinnedOf(schema, undefined), { path: schema });
  });
});

describe("the interface files compared at the head", () => {
  test("each of the four outcomes is named once, and an unchanged file is not", () => {
    const base = [
      { path: schema, hash: one },
      { path: manifest, hash: two },
      { path: "a.json" },
      { path: "b.json", hash: one },
      { path: "c.json", hash: two },
    ];
    const head = [
      { path: schema, hash: one },
      { path: manifest, hash: other },
      { path: "a.json", hash: one },
      { path: "b.json" },
    ];
    assert.deepEqual(interfaceChanges({ base, head }), [
      { path: manifest, how: "changed" },
      { path: "a.json", how: "appeared" },
      { path: "b.json", how: "vanished" },
      { path: "c.json", how: "not compared" },
    ]);
    assert.deepEqual(interfaceWords({ base, head }), [
      `interface file changed during the rounds: ${manifest}`,
      "interface file appeared during the rounds: a.json",
      "interface file is gone at the head: b.json",
      "interface file could not be compared with the base: c.json",
    ]);
    assert.deepEqual(interfaceClauses(interfaceChanges({ base, head })), [
      `the interface file ${manifest} changed during the rounds`,
      "the interface file a.json appeared during the rounds",
      "the interface file b.json is gone at the head",
      "the interface file c.json could not be compared with the base",
    ]);
  });

  test("a file absent at both ends is unchanged", () => {
    assert.deepEqual(interfaceChanges({ base: [{ path: schema }], head: [{ path: schema }] }), []);
  });

  test("a head listed in another order still matches each file by its path", () => {
    const base = [
      { path: schema, hash: one },
      { path: manifest, hash: two },
    ];
    const head = [
      { path: manifest, hash: two },
      { path: schema, hash: one },
    ];
    assert.deepEqual(interfaceChanges({ base, head }), []);
    assert.deepEqual(interfaceWords({ base, head }), ["interface files: 2 unchanged since the base, by hash"]);
    assert.deepEqual(
      interfaceChanges({
        base,
        head: [
          { path: manifest, hash: other },
          { path: schema, hash: one },
        ],
      }),
      [{ path: manifest, how: "changed" }],
    );
  });

  test("no interface files say nothing; the unchanged files counted are those pinned at the base", () => {
    assert.deepEqual(interfaceChanges({ base: [], head: [] }), []);
    assert.deepEqual(interfaceWords({ base: [], head: [{ path: schema, hash: one }] }), []);
    assert.deepEqual(interfaceWords({ base: [{ path: schema, hash: one }], head: [{ path: schema, hash: one }] }), [
      "interface files: 1 unchanged since the base, by hash",
    ]);
    const extra = [
      { path: schema, hash: one },
      { path: manifest, hash: two },
    ];
    assert.deepEqual(interfaceWords({ base: [{ path: schema, hash: one }], head: extra }), [
      "interface files: 1 unchanged since the base, by hash",
    ]);
  });
});

describe("the merge card and the interface files", () => {
  test("a file that could not be compared at the head withholds merge, naming it, and keep stays", () => {
    const pins = {
      base: [
        { path: schema, hash: one },
        { path: manifest, hash: two },
      ],
      head: [{ path: manifest, hash: two }],
    };
    const merge = drawn(mergeInput({ pins }));
    assert.equal(merge.merge, false);
    assert.equal(merge.card.withheld.merge, `The interface file ${schema} could not be compared with the base.`);
    assert.deepEqual(Object.keys(merge.card.withheld), ["merge", "send-back", "discard"]);
    assert.ok(wordsOf(mergeInput({ pins })).includes(`interface file could not be compared with the base: ${schema}`));
  });

  test("a changed file withholds merge; the same hashes offer it", () => {
    const base = [{ path: schema, hash: one }];
    assert.equal(
      drawn(mergeInput({ pins: { base, head: [{ path: schema, hash: other }] } })).card.withheld.merge,
      `The interface file ${schema} changed during the rounds.`,
    );
    assert.equal(drawn(mergeInput({ pins: { base, head: base } })).merge, true);
  });

  test("pins recorded and no head hashed at all: each file is not compared and merge is withheld for it too", () => {
    const leaked: RoundsOnCard = { count: 1, most: 3, ended: "leak" };
    const input = mergeInput({
      rounds: leaked,
      leaks: [{ kind: "mark-in-answer" }],
      pins: { base: [{ path: schema, hash: one }, { path: manifest }], head: [] },
    });
    const merge = drawn(input);
    assert.equal(
      merge.card.withheld.merge,
      "The builder's work holds text from the tests; " +
        `the interface file ${schema} could not be compared with the base; ` +
        `the interface file ${manifest} could not be compared with the base.`,
    );
    const words = wordsOf(input);
    assert.ok(words.includes(`interface file could not be compared with the base: ${schema}`));
    assert.ok(words.includes(`interface file could not be compared with the base: ${manifest}`));
    assert.ok(!words.some((line) => line.includes("unchanged since the base")));
  });
});
