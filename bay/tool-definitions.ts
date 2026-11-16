import type { Json } from "./contracts.ts";
import type { ToolName } from "./skill-tools.ts";

type JsonObject = { readonly [key: string]: Json };

export const actionsToolName = "actions";

export type ToolDefinition = {
  readonly name: ToolName | typeof actionsToolName;
  readonly description: string;
  readonly inputSchema: JsonObject;
};

const tokenProperty = {
  type: "string",
  description: "The token of your task, exactly as the task gave it. Every call needs it.",
};

function inputSchema(properties: JsonObject, required: readonly string[]): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: ["token", ...required],
    properties: { token: tokenProperty, ...properties },
  };
}

export const toolDefinitions: readonly ToolDefinition[] = [
  {
    name: actionsToolName,
    description:
      "Find out what agentbay can do, from the project as it was loaded. With no mode, it lists each active mode " +
      "with its description. With a mode, it lists that mode's actions as mode.action, each with its description, " +
      "effects and input schema. find keeps the entries whose name or description holds every given word, " +
      "whatever the case. It needs no token.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", description: "The mode whose actions to list; leave it out to list the modes." },
        find: { type: "string", description: "Words that every listed name or description must hold." },
      },
    },
  },
  {
    name: "db_query",
    description:
      "Run one read-only SELECT on your mode's own database and get back its columns and rows. " +
      "At most 200 rows and 2 seconds; narrow the query with where, limit or an aggregate. " +
      "Available only when your skill lists db under Tools.",
    inputSchema: inputSchema({ sql: { type: "string", description: "One SELECT statement, without ;." } }, ["sql"]),
  },
  {
    name: "files_read",
    description:
      "Read one text file inside the paths your step may read (your mode's folder and its declared paths). " +
      "Available only when your skill lists files under Tools.",
    inputSchema: inputSchema({ path: { type: "string", description: "The file, relative to the project." } }, ["path"]),
  },
  {
    name: "files_list",
    description:
      "List the names in one folder inside the paths your step may read. " +
      "Available only when your skill lists files under Tools.",
    inputSchema: inputSchema({ path: { type: "string", description: "The folder, relative to the project." } }, [
      "path",
    ]),
  },
  {
    name: "files_write",
    description:
      "Write one text file inside the paths your step may write, replacing it whole. " +
      "Available only when your skill lists files under Tools.",
    inputSchema: inputSchema(
      {
        path: { type: "string", description: "The file, relative to the project." },
        text: { type: "string", description: "The whole new content of the file." },
      },
      ["path", "text"],
    ),
  },
  {
    name: "call_action",
    description:
      "Run an action your skill lists under Tools (an action of your mode, or interface.action) and get its " +
      "output. Only actions whose effects are read only can be called; budgets and permissions apply.",
    inputSchema: inputSchema(
      {
        action: { type: "string", description: "The action as your skill's Tools section names it." },
        input: { description: "The action's input, as its input schema describes it." },
      },
      ["action"],
    ),
  },
  {
    name: "submit",
    description:
      "Hand in the output of your task. The answer says accepted: true when the step is done, or lists the " +
      "schema problems or the check feedback; then correct the output and submit again, with the token the " +
      "answer gives.",
    inputSchema: inputSchema(
      {
        output: { description: "Your output, matching the task's outputSchema and every schema in alsoMatches." },
        tokens: { type: "integer", minimum: 0, description: "The model tokens you used, if you know them." },
        usd: { type: "number", minimum: 0, description: "The US dollars you spent, if you know them." },
      },
      ["output"],
    ),
  },
];
