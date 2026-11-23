import { homedir } from "node:os";
import { join } from "node:path";
import {
  RECALL_LIMIT,
  SCHEMA,
  UserError,
  parseForget,
  parseInput,
  parseRecall,
  parseRemember,
  resolveDataDir,
} from "./rules.ts";
import { openStore, type Store } from "./store.ts";

type Handler = (store: Store, input: Record<string, unknown>, now: Date) => object;

const handlers: Record<string, Handler> = {
  remember(store, input, now) {
    const { id, fact, topic } = store.add(parseRemember(input), now.toISOString());
    return { id, fact, topic };
  },
  recall(store, input) {
    return { facts: store.list(parseRecall(input), RECALL_LIMIT) };
  },
  forget(store, input) {
    const id = parseForget(input);
    if (!store.remove(id)) throw new UserError("No fact has that id.");
    return { id, forgotten: true };
  },
};

function execute(
  args: string[],
  env: Record<string, string | undefined>,
  now: Date,
): object {
  const [action, rawInput = "{}"] = args;
  if (action === "schema") return SCHEMA;
  const handler = action === undefined ? undefined : handlers[action];
  if (!handler) throw new UserError(`Unknown action: ${action ?? "(none)"}.`);
  const input = parseInput(rawInput);
  const store = openStore(join(resolveDataDir(env, homedir()), "cos.db"));
  try {
    return handler(store, input, now);
  } finally {
    store.close();
  }
}

function main(): void {
  try {
    const output = execute(process.argv.slice(2), process.env, new Date());
    console.log(JSON.stringify(output));
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    console.log(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}

main();
