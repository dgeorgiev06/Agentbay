# A design states its rules

Design note DS2, 2026-11-21. Words are used as `CONTEXT.md` defines them.

## Why

In the second live run of forge's `design` workflow (todo mode, light path) the challenger answered P-52 not held
twice: the thin script that writes `todo-ids` worked out the next id itself. The designer could answer only by
rewording two sentences, since `schemas/design.json` had no place for a pure function, and the second challenger
rightly judged the sentence, not the design. The same run showed a second gap: the designer has only reading tools
and could not type a 500- or 501-character text, so the two examples that conditions O1-C4 and O1-C7 need were left
out.

## Decision

1. A module lists `rules`. A rule has a `name` (the name of its pure function), `decides` (one sentence), `takes`
   and `gives`: lists of values, each a `name`, a JSON Schema and, for a value read from or written to storage, the
   `store` it belongs to (a table or file of the module). A value with no store comes from the request or from the
   thin function, such as the time, in `takes`, and is the answer, in `gives`. When a rule refuses, it gives the
   refusal sentence in place of its values, and the action writes nothing.
2. An action names the `rule` it applies, and in `reads` and `writes` the tables and files its thin function reads
   before and writes after.
3. The design check holds, by script (`scripts/lib/rules-applied.ts`): an action that writes or refuses applies a
   rule; the rule exists and belongs to a module that offers the action's interface; an action reads and writes only
   what its module owns, and a rule stores only in its own module; what an action writes is exactly what its rule
   gives to storage, and what it reads exactly what its rule takes from storage; every rule is applied; rule and value
   names are unique; every owned table and file is read or written by some action; a rule's schema refers only to
   itself or to `schemas/<interface>/<action>-<side>.json` of an interface its module implements.
4. A worked example may say a long text by rule: `{"$text": [part, ...]}`, each part a text or
   `{"repeat": "<text>", "times": <count>}`, at most 20 parts and 10,000 characters counted in Unicode code points.
   One pure function, `spelledOut` in `scripts/lib/long-texts.ts`, spells it out for every reader: the examples'
   check against the schemas, the design check (which refuses a form it cannot spell), the card's count, and the
   leak check's reading of the interface files. The committed `design.yaml` keeps the short form.

5. Sent back once (second pass of DS2): the test writer tests a rule through the entry of the action that
   applies it, and reads the rule only to choose its cases (what it takes: the states to set up; what it gives:
   the answers, refusals and what later calls must show). The other choice, a file and exported name fixed by
   the design for both sides, would couple the test to the builder's layout and make the design own a code
   path; through the entry the test holds the rule as a caller sees it (P-15), and the reviewer holds the code
   to the rule's name (camelCase of the rule's name) and its takes and gives. More checks hold what a script
   can: a rule takes an unstored value when its action's request has fields and gives one when the action has
   a response; no value has an empty schema; an example after calls the examples refuse answers as the same
   calls without them, where the examples show both; no schema has a field named `$text`; and the plan names a
   slice that meets a condition while naming the request file of no action that serves it. The challenger is
   told what no script can see.

## Reasons

- The smallest form the check can hold. "The script works out the next id itself" becomes a table the action
  writes that no rule gives: a sentence on the card, found before any challenger reads the design.
- The rule's inputs and outputs are named with schemas, so the test writer can call the rule with values and compare
  the value it gives, and the reviewer can hold the code to the names.
- `reads` and `writes` sit on the action, apart from the rule, because the fault of the live run was exactly a gap
  between the two: the action's storage and the rule's gives.
- A rule's `$ref` is written relative to the design's folder (`schemas/todo/add-request.json`), so it resolves the
  same in the handed-in design and in the committed `design.yaml`, and no rewriting is needed.
- Every new field is optional in the schema, so older designs still parse; the check then asks for `reads` and
  `writes` by the owned-store rule and for a rule where an action writes or refuses.
- A long text said by rule is bounded and counted in code points, as JSON Schema's `maxLength` counts, so a
  500-character text of emoji is 500 characters. The form is an object whose only key is `$text`, which no request
  of a real action is likely to be; an object with `$text` beside other keys is plain data.

## What it does not hold

- That a rule is truly pure, or that its sentence is true: the challenger judges that from the rule, and the
  reviewer from the code.
- That a value with no store comes from the request: the check cannot see where the thin function gets it.
- An action that writes nothing and refuses in no example need not apply a rule, so a read-only action may still
  decide something in its thin function; the challenger judges it.
