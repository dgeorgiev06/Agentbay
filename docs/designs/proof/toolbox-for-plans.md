# The toolbox for reading a plan: three functions, for W1 and P2

Slice TB1 gave every mode three things. A script reads a plan with them: text to a value, the value checked against a schema, and paths matched against a slice's write scope. This note shows each as a caller uses it.

## readYaml: YAML text to a value

`readYaml(text)` is a pure function of the toolbox. It reads no file: the script reads the text through `context.files.read` first. It is the reader the kernel uses for manifests, with the same limits.

```ts
import { defineScript, fail, readYaml } from "agentbay/sdk";

export const run = defineScript(async (input, context) => {
  const text = await context.files.read("plans/forge.yaml");
  if (!text.ok) {
    return fail(text.message);
  }
  const read = readYaml(text.value);
  if (!read.ok) {
    return { refused: read.problems.map((problem) => `line ${String(problem.line)}: ${problem.message}`) };
  }
  return { plan: read.value, nameLine: read.lineOf(["slices", 0, "name"]) ?? null };
});
```

A problem has a line, a message and a fix. The limits, each with its own sentence:

- at most 262,144 characters;
- at most 64 levels of nesting;
- aliases that copy at most 100 nodes;
- only YAML's own tags: str, int, float, bool, null, map and seq (`!shell` and `!!binary` are refused);
- no number JSON cannot hold (`.inf`, `.nan`).

Text that is not YAML gives the parser's sentence with its line. Empty text is the value `null`, not a problem.

## context.schemas.check: a value checked against a schema

`context.schemas.check(schema, value)` is an operation of the broker, `schemas.read`. The kernel finds the schema by its name and reads it with the parts it refers to. The check itself runs inside the script's own process, with the kernel's own checker. A schema whose pattern backtracks without end therefore stops only the script, at its time limit.

```ts
const checked = await context.schemas.check("schemas/plan.json", read.value);
if (!checked.ok) {
  return fail(checked.message);
}
if (!checked.value.passed) {
  return { refused: checked.value.problems.map((problem) => `${problem.path || "/"}: ${problem.message}`) };
}
```

A schema is named in one of two ways:

- a `.json` file in the mode's own folder, such as `schemas/plan.json`;
- a schema file that the yaml of an interface the mode implements or requires names, written `<interface>@<major>/<file>`, such as `proof@1/prove-request.json`.

Any other name is refused, with a sentence that lists the names the mode may use. The answer is `{ passed: true, value }` or `{ passed: false, problems }`. Each problem has a path (a JSON pointer), the kernel's message and sometimes a fix, in the same words `bay` uses for an action's input. A schema that is missing, is not JSON, cannot be compiled, or refers to something wrongly refuses the value with a problem that says so.

## A schema that holds part of an interface's schema

A mode's schema refers to a part of an interface's schema with `$ref`, written `<interface>@<major>/<file>#<pointer>`. A plan's slice is then `proof@1`'s slice and cannot drift from it:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["slices"],
  "properties": {
    "slices": { "type": "array", "items": { "$ref": "proof@1/prove-request.json#/$defs/slice" } }
  }
}
```

The kernel follows the reference when it reads the mode's schema, for an action, for settings and for `context.schemas.check`. `bay check` reports a reference to a part that is not there ("names nothing") and a reference to a file the mode may not name, each as an error with a fix. The parts a part refers to in other files are not followed.

## pathMatch: a path matched against a pattern

`pathMatch(pattern, path)` is a pure function of the toolbox, in the dialect of `proof@1`'s sentence. The answer is `matched`, `not matched`, `not a pattern` or `not a path`. The last two come with the reason.

```ts
import { pathMatch } from "agentbay/sdk";

const outside = changed.filter((path) => !slice.scope.some((pattern) => pathMatch(pattern, path).kind === "matched"));
```

- `*` stands for any characters inside one folder or file name. It matches a name that starts with a dot.
- `**` as a whole part stands for any number of folders. At the end of a pattern it stands for at least one, so `bay/broker/**` holds `bay/broker/rule.ts` and not `bay/broker` or `bay/brokers.ts`.
- `**` inside a part, as in `bay/broker**`, is two `*` and stays inside one name.
- A pattern without a star names one path: `bay/broker` does not hold `bay/broker/rule.ts`.
- Matching is case-sensitive.
- A leading `./` and a `.` part are dropped from patterns and paths. A trailing slash is dropped from a path.
- A pattern that is empty, starts with `/` or `-`, ends with `/`, holds `//` or `..`, holds a character other than letters, digits, `_ . * / -`, or is longer than 1,000 characters is not a pattern. These are the patterns `proof@1`'s schema refuses.
- A path that is empty, starts with `/`, holds `//` or a `..` part is not a path.

The table in `tests/path-match.test.ts` pins every case, and runs each pattern through the interface's own regular expression too.
