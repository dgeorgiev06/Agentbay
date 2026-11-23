export type Todo = {
  readonly id: string;
  readonly text: string;
  readonly due: string | null;
  readonly done: boolean;
  readonly createdAt: string;
};

export type Status = "open" | "done" | "all";

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export type NewTodo = { readonly text: string; readonly due: string | null };

const longestText = 500;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const idPattern = /^t([1-9]\d*)$/;

export const schema = {
  add: {
    input: {
      text: `string, required, at most ${longestText} characters`,
      due: "YYYY-MM-DD, optional",
    },
    output: { id: "string", text: "string", due: "YYYY-MM-DD, only when set" },
  },
  list: {
    input: { status: "open | done | all, optional, default open" },
    output: { todos: "[{ id, text, due?, done }] ordered by due date then creation" },
  },
  finish: {
    input: { id: "string, required, as returned by add" },
    output: { id: "string", done: true },
  },
  export: {
    input: {},
    output: { todos: "[{ id, text, due, done, createdAt }] every todo, in creation order" },
  },
  setup: {
    input: {},
    output: { allow: "permission rules to add to the user's settings" },
  },
  schema: {
    input: {},
    output: { actions: "this description" },
  },
};

export const permissions = { allow: ["Bash(todo *)"] };

function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

function succeed<T>(value: T): Result<T> {
  return { ok: true, value };
}

function characterCount(text: string): number {
  return Array.from(segmenter.segment(text)).length;
}

function isRealDate(value: string): boolean {
  const match = datePattern.exec(value);
  if (match === null) {
    return false;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseInput(raw: string): Result<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return succeed(parsed as Record<string, unknown>);
    }
  } catch {
    return fail("The input is not valid JSON: pass one JSON object.");
  }
  return fail("The input must be a JSON object.");
}

export function normalizeAdd(input: Record<string, unknown>): Result<NewTodo> {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text === "") {
    return fail("The text is empty: say what the todo is.");
  }
  if (characterCount(text) > longestText) {
    return fail(`The text may be at most ${longestText} characters: shorten it.`);
  }
  if (input.due === undefined) {
    return succeed({ text, due: null });
  }
  if (typeof input.due !== "string" || !isRealDate(input.due)) {
    return fail("The due date must be a real date written as YYYY-MM-DD.");
  }
  return succeed({ text, due: input.due });
}

export function normalizeStatus(input: Record<string, unknown>): Result<Status> {
  const status = input.status ?? "open";
  if (status === "open" || status === "done" || status === "all") {
    return succeed(status);
  }
  return fail("The status must be open, done or all.");
}

export function parseId(input: Record<string, unknown>): Result<number> {
  const match = typeof input.id === "string" ? idPattern.exec(input.id.trim()) : null;
  return match === null ? fail("The id must look like t1.") : succeed(Number(match[1]));
}

export function checkFinishable(todo: Todo | undefined, id: number): Result<Todo> {
  if (todo === undefined) {
    return fail(`No todo has the id t${id}: list all todos to see the ids.`);
  }
  if (todo.done) {
    return fail(`Todo ${todo.id} is already done.`);
  }
  return succeed(todo);
}

function compareDue(a: Todo, b: Todo): number {
  if (a.due === b.due) {
    return 0;
  }
  if (a.due === null) {
    return 1;
  }
  if (b.due === null) {
    return -1;
  }
  return a.due < b.due ? -1 : 1;
}

function compareCreated(a: Todo, b: Todo): number {
  return a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? -1 : 1;
}

export function selectTodos(todos: readonly Todo[], status: Status): readonly Todo[] {
  const wanted = todos.filter((todo) => status === "all" || todo.done === (status === "done"));
  return [...wanted].sort((a, b) => compareDue(a, b) || compareCreated(a, b));
}

export function present(todo: Todo) {
  return {
    id: todo.id,
    text: todo.text,
    ...(todo.due === null ? {} : { due: todo.due }),
    done: todo.done,
  };
}
