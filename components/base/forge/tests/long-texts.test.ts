import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { textOf } from "../scripts/lib/json-values.ts";
import { spelledOut } from "../scripts/lib/long-texts.ts";

const mostCodePoints = 10_000;

const mostParts = 20;

describe("a long text said by rule in a worked example, spelled out by one function", () => {
  test("500 times a is the text of 500 a's, and a value with no form is left as it is", () => {
    const spelled = spelledOut({ text: { $text: [{ repeat: "a", times: 500 }] } });
    assert.deepEqual(spelled, { value: { text: "a".repeat(500) }, forms: 1, refused: [] });
    assert.deepEqual(spelledOut({ text: "buy milk", tags: [1, null] }), {
      value: { text: "buy milk", tags: [1, null] },
      forms: 0,
      refused: [],
    });
  });

  test("parts of mixed text are joined in order, and their length is counted in code points", () => {
    const parts = ["x", { repeat: "ü", times: 250 }, { repeat: "🥛", times: 249 }];
    const { value } = spelledOut({ $text: parts });
    assert.equal(value, `x${"ü".repeat(250)}${"🥛".repeat(249)}`);
    assert.equal(Array.from(textOf(value)).length, 500);
  });

  test("the bound is in code points: 10,000 emoji are spelled, though they are 20,000 UTF-16 units", () => {
    const spelled = spelledOut({ $text: [{ repeat: "🥛", times: mostCodePoints }] });
    assert.deepEqual(spelled.refused, []);
    assert.equal(textOf(spelled.value).length, 2 * mostCodePoints);
  });

  test("a form past the bound is refused and left as written, and a huge count is refused without being built", () => {
    const past = { $text: [{ repeat: "ab", times: 5000 }, "c"] };
    assert.deepEqual(spelledOut([past]), {
      value: [past],
      forms: 1,
      refused: [
        "it spells 10,001 characters, counted in Unicode code points, and a text said by rule spells at most 10,000",
      ],
    });
    const huge = spelledOut({ $text: [{ repeat: "a", times: 1e12 }] });
    assert.equal(huge.refused.length, 1);
  });

  test("more parts than the bound, a part of no known form and a $text that is not a list are refused", () => {
    const many = { $text: Array.from({ length: mostParts + 1 }, () => "a") };
    const badParts = [{ repeat: "", times: 3 }, { repeat: "a", times: 1.5 }, { repeat: "a", times: 2, more: 1 }, 7];
    assert.deepEqual(
      [many, ...badParts.map((part) => ({ $text: ["ok", part] })), { $text: "a" }].map(
        (form) => spelledOut(form).refused,
      ),
      [
        ["it has 21 parts, and a text said by rule has at most 20; join parts that repeat the same text"],
        ...badParts.map(() => [
          'part 2 is neither a text nor {"repeat": "<text>", "times": <count>}, with a text that is not empty and a whole count from 1',
        ]),
        ['its "$text" is not a list; give a list of parts, each a text or {"repeat": "<text>", "times": <count>}'],
      ],
    );
  });

  test("forms are found at any depth, and an object with $text beside other fields is plain data", () => {
    const plain = { $text: [{ repeat: "a", times: 2 }], other: 1 };
    const spelled = spelledOut({ todos: [{ text: { $text: ["b", { repeat: "c", times: 2 }] } }], plain });
    assert.deepEqual(spelled, { value: { todos: [{ text: "bcc" }], plain }, forms: 1, refused: [] });
  });
});
