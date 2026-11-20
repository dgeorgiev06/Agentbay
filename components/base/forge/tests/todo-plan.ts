import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Json } from "../../../../bay/sdk.ts";
import type { Written } from "../scripts/lib/commit-files.ts";
import { designFiles } from "../scripts/lib/design-files.ts";
import { designOf } from "../scripts/lib/design-form.ts";
import { todoDesign } from "./todo-design.ts";

export const requirementsFile = "docs/requirements/todo.yaml";

export const designFile = "docs/designs/todo/design.yaml";

const schemas = "docs/designs/todo/schemas/todo";

const one = ["O1-C1", "O1-C2", "O1-C3", "O1-C4", "O1-C5", "O1-C6", "O1-C7"];

const two = ["O2-C1", "O2-C2", "O2-C3", "O2-C4", "O2-C5", "O2-C6"];

export const tdOneTitle = "A todo mode that adds a todo and lists the open ones";

export const tdTwoTitle = "The todo mode marks a todo done and removes one";

export const oneAfterAnother = "Both slices write the one mode's folder, and the second adds to what the first makes.";

export const tdTwoAfter = "It adds two actions to the mode TD1 makes.";

function checksItem(name: string): Json {
  return {
    id: `DOD-${name}-1`,
    says: "The kit's checks pass with the todo mode in it.",
    level: "must",
    proof: { kind: "checks" },
  };
}

function testItem(name: string, test: string): Json {
  const says = "The mode's own test fails without the mode's code and passes with it.";
  return { id: `DOD-${name}-2`, says, level: "must", proof: { kind: "fails-first", tests: [test] } };
}

export const tdOne: Json = {
  title: tdOneTitle,
  meets: one,
  interface: [
    `${schemas}/add-request.json`,
    `${schemas}/add-response.json`,
    `${schemas}/list-request.json`,
    `${schemas}/list-response.json`,
  ],
  slice: {
    name: "TD1",
    kind: "mode",
    scope: ["components/modes/todo/**"],
    after: [],
    done: [checksItem("TD1"), testItem("TD1", "components/modes/todo/tests/todo.test.ts")],
  },
};

export const tdTwo: Json = {
  title: tdTwoTitle,
  meets: two,
  interface: [
    `${schemas}/add-response.json`,
    `${schemas}/done-request.json`,
    `${schemas}/done-response.json`,
    `${schemas}/remove-request.json`,
    `${schemas}/remove-response.json`,
  ],
  slice: {
    name: "TD2",
    kind: "mode",
    scope: ["components/modes/todo/**"],
    after: [{ slice: "TD1", because: tdTwoAfter }],
    done: [checksItem("TD2"), testItem("TD2", "components/modes/todo/tests/done-remove.test.ts")],
  },
};

export const todoPlan: Json = {
  title: "The todo mode",
  oneAfterAnotherBecause: oneAfterAnother,
  slices: [tdOne, tdTwo],
};

export function todoDesignFiles(): readonly Written[] {
  return designFiles({ job: "todo", file: requirementsFile, version: 1, design: designOf(todoDesign) });
}

export async function writtenIn(root: string, files: readonly Written[]): Promise<void> {
  for (const file of files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.text, "utf8");
  }
}
