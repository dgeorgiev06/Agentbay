import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  checkFinishable,
  normalizeAdd,
  normalizeStatus,
  parseId,
  parseInput,
  permissions,
  present,
  schema,
  selectTodos,
  type Result,
} from "./rules.ts";
import { openStore, type Store } from "./store.ts";

type Deps = { readonly store: Store; readonly clock: () => Date };
type Action = (input: Record<string, unknown>, deps: Deps) => Result<object>;

function map<A, B>(result: Result<A>, next: (value: A) => Result<B>): Result<B> {
  return result.ok ? next(result.value) : result;
}

const plain: Record<string, () => object> = {
  schema: () => ({ actions: schema }),
  setup: () => permissions,
};

const actions: Record<string, Action> = {
  add: (input, { store, clock }) =>
    map(normalizeAdd(input), (newTodo) => {
      const todo = store.add(newTodo, clock().toISOString());
      const { id, text, due } = present(todo);
      return { ok: true, value: { id, text, ...(due === undefined ? {} : { due }) } };
    }),

  list: (input, { store }) =>
    map(normalizeStatus(input), (status) => ({
      ok: true,
      value: { todos: selectTodos(store.all(), status).map(present) },
    })),

  finish: (input, { store }) =>
    map(parseId(input), (id) =>
      map(checkFinishable(store.find(id), id), (todo) => {
        store.markDone(id);
        return { ok: true, value: { id: todo.id, done: true } };
      }),
    ),

  export: (_input, { store }) => ({ ok: true, value: { todos: store.all() } }),
};

function dataDir(env: NodeJS.ProcessEnv): string {
  return join(env.AGENTBAY_HOME || join(homedir(), ".agentbay"), "todo");
}

function openAt(directory: string): Result<Store> {
  try {
    mkdirSync(directory, { recursive: true });
    return { ok: true, value: openStore(join(directory, "todo.db")) };
  } catch {
    return { ok: false, error: `Cannot open the todo store at ${directory}.` };
  }
}

function print(output: object, exitCode: number): void {
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}

function printResult(result: Result<object>): void {
  print(result.ok ? result.value : { error: result.error }, result.ok ? 0 : 1);
}

function main(args: readonly string[], env: NodeJS.ProcessEnv, clock: () => Date): void {
  const [name = "", raw = "{}"] = args;
  if (Object.hasOwn(plain, name)) {
    return print(plain[name](), 0);
  }
  if (!Object.hasOwn(actions, name)) {
    const known = [...Object.keys(actions), ...Object.keys(plain)].join(", ");
    return print({ error: `Unknown action: use ${known}.` }, 1);
  }
  const input = parseInput(raw);
  if (!input.ok) {
    return printResult(input);
  }
  const store = openAt(dataDir(env));
  if (!store.ok) {
    return printResult(store);
  }
  try {
    printResult(actions[name](input.value, { store: store.value, clock }));
  } finally {
    store.value.close();
  }
}

try {
  main(process.argv.slice(2), process.env, () => new Date());
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  print({ error: `Unexpected failure: ${reason}` }, 1);
}
