import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  checkFinishable,
  normalizeAdd,
  normalizeStatus,
  parseId,
  parseInput,
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
};

function dataDir(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_PLUGIN_DATA || env.AGENTBAY_DATA_DIR || join(homedir(), ".agentbay", "todo");
}

function print(output: object, exitCode: number): void {
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}

function printResult(result: Result<object>): void {
  print(result.ok ? result.value : { error: result.error }, result.ok ? 0 : 1);
}

function main(args: readonly string[], env: NodeJS.ProcessEnv, clock: () => Date): void {
  const [name, raw = "{}"] = args;
  if (name === "schema") {
    return print({ actions: schema }, 0);
  }
  if (name === undefined || !Object.hasOwn(actions, name)) {
    return print({ error: "Unknown action: use add, list, finish or schema." }, 1);
  }
  const input = parseInput(raw);
  if (!input.ok) {
    return printResult(input);
  }
  const directory = dataDir(env);
  mkdirSync(directory, { recursive: true });
  const store = openStore(join(directory, "todo.db"));
  try {
    printResult(actions[name](input.value, { store, clock }));
  } finally {
    store.close();
  }
}

main(process.argv.slice(2), process.env, () => new Date());
