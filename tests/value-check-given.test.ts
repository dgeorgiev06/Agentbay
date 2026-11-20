import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { mock, test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Json } from "../bay/contracts.ts";
import { isJson } from "../bay/protocol-json.ts";
import { checkedAgainst } from "../bay/given-schema.ts";
import { checkedValue } from "../bay/value-check.ts";

const kitRoot = join(import.meta.dirname, "..");

const outsideRule = "a given schema may refer only to its own parts, written #/<path>, and nothing outside it is read";

const item: Json = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["name", "tags"],
  properties: {
    name: { $ref: "#/$defs/name" },
    tags: { type: "array", items: { $ref: "#/$defs/name" } },
  },
  $defs: { name: { type: "string", minLength: 1 } },
};

function compileCounter(): { readonly count: () => number; readonly stop: () => void } {
  const compile = mock.method(Ajv2020.prototype, "compile");
  return {
    count: () => compile.mock.callCount(),
    stop: () => {
      compile.mock.restore();
    },
  };
}

function failedWith(message: string): Json {
  return { ok: false, kind: "failed", message };
}

function nested(depth: number): Json {
  return depth === 0 ? { type: "string" } : { items: nested(depth - 1) };
}

function doubling(levels: number): Json {
  const defs: Record<string, Json> = { level0: { type: "string" } };
  for (let level = 1; level <= levels; level += 1) {
    const below = { $ref: `#/$defs/level${String(level - 1)}` };
    defs[`level${String(level)}`] = { anyOf: [below, below] };
  }
  return { $defs: defs, $ref: `#/$defs/level${String(levels)}` };
}

function described(length: number): Json {
  const frame = JSON.stringify({ description: "" }).length;
  return { description: "x".repeat(length - frame) };
}

test("a value that fits a given schema comes back as it was given", () => {
  const value = { name: "tea", tags: ["green", "loose"] };
  assert.deepEqual(checkedAgainst(item, value), { ok: true, value: { passed: true, value } });
});

test("a value that does not fit gets every problem with its path, in the kernel's words", () => {
  assert.deepEqual(checkedAgainst(item, { name: "", tags: [1], extra: true }), {
    ok: true,
    value: {
      passed: false,
      problems: [
        {
          path: "/extra",
          message: "The value has the field extra, which is not allowed here.",
          fix: "Remove extra or correct its spelling.",
        },
        { path: "/name", message: "name must not be empty." },
        { path: "/tags/0", message: "tags.0 must be text, but it is 1." },
      ],
    },
  });
  assert.deepEqual(checkedAgainst(item, { tags: [] }), {
    ok: true,
    value: {
      passed: false,
      problems: [{ path: "", message: "The value is missing the required field name.", fix: "Add name." }],
    },
  });
});

test("a given schema may refer to its own parts and to itself as a whole", () => {
  const tree = { type: "object", properties: { below: { $ref: "#" } }, additionalProperties: false };
  assert.deepEqual(checkedAgainst(tree, { below: { below: {} } }), {
    ok: true,
    value: { passed: true, value: { below: { below: {} } } },
  });
  assert.deepEqual(checkedAgainst(tree, { below: { other: 1 } }), {
    ok: true,
    value: {
      passed: false,
      problems: [
        {
          path: "/below/other",
          message: "below has the field other, which is not allowed here.",
          fix: "Remove other or correct its spelling.",
        },
      ],
    },
  });
});

test("a reference to a file, an interface, a web address or an anchor is refused with a sentence, and nothing is compiled", () => {
  const outside = [
    "https://example.com/item.json",
    "file:///etc/passwd",
    "proof@1/prove-request.json#/$defs/slice",
    "add-response.json",
    "https://json-schema.org/draft/2020-12/schema",
    "#name",
  ];
  const counter = compileCounter();
  try {
    const answers = outside.map((reference) =>
      checkedAgainst({ type: "object", properties: { item: { $ref: reference } } }, {}),
    );
    assert.deepEqual(
      answers,
      outside.map((reference) =>
        failedWith(`The schema given refers to ${reference} at /properties/item/$ref, outside itself; ${outsideRule}.`),
      ),
    );
    assert.deepEqual(
      checkedAgainst({ $dynamicRef: "https://example.com/meta" }, 1),
      failedWith(
        `The schema given refers to https://example.com/meta at /$dynamicRef, outside itself; ${outsideRule}.`,
      ),
    );
    assert.deepEqual(
      checkedAgainst({ allOf: [{ $recursiveRef: "other.json" }] }, 1),
      failedWith(`The schema given refers to other.json at /allOf/0/$recursiveRef, outside itself; ${outsideRule}.`),
    );
    assert.equal(counter.count(), 0);
  } finally {
    counter.stop();
  }
});

test("a reference to a part the schema does not have is refused with a sentence", () => {
  assert.deepEqual(
    checkedAgainst({ $defs: { name: { type: "string" } }, $ref: "#/$defs/nmae" }, "tea"),
    failedWith(
      "The schema given refers to #/$defs/nmae at /$ref, which names none of its parts; refer to a part it has, " +
        "such as #/$defs/<name>.",
    ),
  );
});

test("a reference written with escapes names the part the validator finds, and its unfolding counts that part", () => {
  const escaped = { $defs: { "a/b": { type: "string" } }, $ref: "#/%24defs/a~1b" };
  assert.deepEqual(checkedAgainst(escaped, 1), {
    ok: true,
    value: { passed: false, problems: [{ path: "", message: "The value must be text, but it is 1." }] },
  });
  const levels = 40;
  const defs: Record<string, Json> = { level0: { type: "string" } };
  for (let level = 1; level <= levels; level += 1) {
    const below = { $ref: `#/%24defs/level${String(level - 1)}` };
    defs[`level${String(level)}`] = { allOf: [below, below] };
  }
  const hidden = checkedAgainst({ $defs: defs, $ref: `#/%24defs/level${String(levels)}` }, 1);
  assert.deepEqual(
    hidden,
    failedWith(
      "The schema given grows past 65536 parts when each of its references is followed in place, so checking a " +
        "value against it could run without end; refer to shared parts from fewer places.",
    ),
  );
});

test("an $id below the top is refused, so that every #/ reference names a part of the whole schema", () => {
  const scoped = {
    $id: "https://example.com/top.json",
    $defs: { name: { type: "string" }, inner: { $id: "inner.json", $ref: "#/$defs/name" } },
    $ref: "#/$defs/inner",
  };
  assert.deepEqual(
    checkedAgainst(scoped, "tea"),
    failedWith(
      "The schema given sets $id at /$defs/inner; a given schema may set $id only at its top, so that each #/ " +
        "reference names a part of the whole schema.",
    ),
  );
  assert.deepEqual(checkedAgainst({ $id: "https://example.com/top.json", type: "string" }, "tea"), {
    ok: true,
    value: { passed: true, value: "tea" },
  });
});

test("a schema of 65536 characters is checked, and one of 65537 is refused with its size", () => {
  assert.deepEqual(checkedAgainst(described(65_536), 1), { ok: true, value: { passed: true, value: 1 } });
  assert.deepEqual(
    checkedAgainst(described(65_537), 1),
    failedWith(
      "The schema given is 65537 characters long as JSON, longer than the 65536 a given schema may be; make it " +
        "shorter, such as by naming a repeated part once under $defs.",
    ),
  );
});

test("a schema nested deeper than the kernel reads is refused, not thrown", () => {
  assert.deepEqual(checkedAgainst(nested(63), [[["a"]]]), { ok: true, value: { passed: true, value: [[["a"]]] } });
  assert.deepEqual(
    checkedAgainst(nested(64), []),
    failedWith(
      "The schema given is nested more than 64 levels deep, deeper than the kernel reads; name deep parts under " +
        "$defs and refer to them.",
    ),
  );
});

test("references that multiply past 65536 parts are refused at once, before anything is compiled", () => {
  assert.deepEqual(checkedAgainst(doubling(10), "tea"), { ok: true, value: { passed: true, value: "tea" } });
  const counter = compileCounter();
  const started = performance.now();
  try {
    assert.deepEqual(
      checkedAgainst(doubling(40), 1),
      failedWith(
        "The schema given grows past 65536 parts when each of its references is followed in place, so checking a " +
          "value against it could run without end; refer to shared parts from fewer places.",
      ),
    );
    assert.equal(counter.count(), 0);
  } finally {
    counter.stop();
  }
  assert.ok(performance.now() - started < 2_000, "the refusal took longer than two seconds");
});

test("something that is not a schema is answered as a problem, not thrown", () => {
  assert.deepEqual(
    checkedAgainst({ type: "strng" }, 1),
    failedWith(
      "The schema given is not a usable JSON Schema: schema is invalid: data/type must be equal to one of the " +
        "allowed values, data/type must be array, data/type must match a schema in anyOf.",
    ),
  );
  assert.deepEqual(
    checkedAgainst(5, 1),
    failedWith("The schema given is not a usable JSON Schema: a JSON Schema must be a mapping, true or false."),
  );
  assert.deepEqual(
    checkedAgainst({ $schema: "http://json-schema.org/draft-07/schema#", type: "string" }, "tea"),
    failedWith(
      'The schema given is not a usable JSON Schema: no schema with key or ref "http://json-schema.org/draft-07/schema#".',
    ),
  );
});

test("a schema that refers to itself without stepping into the value is answered as a problem, given or in a file", () => {
  const endless =
    "checking a value against it went deeper than the stack allows (Maximum call stack size exceeded), as when it " +
    "refers to itself without stepping into the value";
  for (const schema of [{ $ref: "#" }, { allOf: [{ $ref: "#" }] }, { $dynamicRef: "#" }]) {
    assert.deepEqual(
      checkedAgainst(schema, {}),
      failedWith(`The schema given is not a usable JSON Schema: ${endless}.`),
    );
  }
  assert.deepEqual(checkedValue("schemas/endless.json", { state: "valid", schema: { $ref: "#" }, parts: {} }, {}), {
    passed: false,
    problems: [{ path: "", message: `The schema file schemas/endless.json is not a usable JSON Schema: ${endless}.` }],
  });
});

test("the draft and keywords are those of schema files: 2020-12, and a keyword the kernel does not know is ignored", () => {
  const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "string", madeUp: 3 };
  assert.deepEqual(checkedAgainst(schema, "tea"), { ok: true, value: { passed: true, value: "tea" } });
  assert.deepEqual(checkedValue("schemas/made-up.json", { state: "valid", schema, parts: {} }, "tea"), {
    passed: true,
    value: "tea",
  });
  assert.deepEqual(checkedAgainst({ prefixItems: [{ type: "integer" }] }, ["one"]), {
    ok: true,
    value: { passed: false, problems: [{ path: "/0", message: '0 must be a whole number, but it is "one".' }] },
  });
});

async function jsonFilesUnder(folder: string): Promise<readonly string[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(entry.parentPath, entry.name));
}

function refersOutside(schema: Json): boolean {
  return /"\$ref":"[^#]/.test(JSON.stringify(schema));
}

test("every schema of the kit that refers only to its own parts is within the bounds and usable as given", async () => {
  const folders = [join(kitRoot, "schemas"), join(kitRoot, "components/base/interfaces")];
  const files = (await Promise.all(folders.map(jsonFilesUnder))).flat();
  const schemas = await Promise.all(
    files.map(async (file) => {
      const value: unknown = JSON.parse(await readFile(file, "utf8"));
      assert.ok(isJson(value), file);
      return { file, value };
    }),
  );
  const own = schemas.filter(({ value }) => !refersOutside(value));
  const answers = own.map(({ file, value }) => ({ file, ok: checkedAgainst(value, null).ok }));
  assert.deepEqual(
    answers.filter((answer) => !answer.ok),
    [],
  );
  assert.ok(own.length >= 40, `only ${String(own.length)} schemas were checked`);
});

test("a 257th distinct given schema pushes out the oldest, and every schema still answers for its own content", () => {
  const schemas = Array.from({ length: 257 }, (_, index) => ({
    type: "object",
    required: [`field${String(index)}`],
  }));
  const counter = compileCounter();
  try {
    const answers = schemas.map((schema) => checkedAgainst(schema, {}));
    assert.equal(counter.count(), 257);
    const [first] = schemas;
    assert.ok(first !== undefined);
    assert.deepEqual(checkedAgainst(first, {}), answers[0]);
    assert.deepEqual(checkedAgainst(first, { field0: 1 }), { ok: true, value: { passed: true, value: { field0: 1 } } });
    assert.equal(counter.count(), 258);
    assert.deepEqual(answers[256], {
      ok: true,
      value: {
        passed: false,
        problems: [{ path: "", message: "The value is missing the required field field256.", fix: "Add field256." }],
      },
    });
  } finally {
    counter.stop();
  }
});
