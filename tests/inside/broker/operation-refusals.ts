import type { Json } from "../../../bay/contracts.ts";
import type { OperationName } from "../../../bay/broker/operations.ts";

export type Refused = { readonly what: string; readonly value: Json; readonly problem: string };

type Fields = { readonly [key: string]: Json };

function without(fields: Fields, name: string): Fields {
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key !== name));
}

const notAMapping = "The value is not a mapping.";

function missing(fields: Fields, name: string, problem: string): Refused {
  return { what: `${name} missing`, value: without(fields, name), problem };
}

function given(fields: Fields, change: Fields, problem: string): Refused {
  const what = Object.entries(change).map(([name, value]) => `${name} given as ${JSON.stringify(value)}`);
  return { what: what.join(", "), value: { ...fields, ...change }, problem };
}

function statementCases(sql: string): readonly Refused[] {
  const statement = { sql, parameters: [], partition: "feed-briefing" };
  const sqlProblem = "The field sql is missing or is not text.";
  const parametersProblem = "The field parameters is missing or is not a list or a mapping.";
  return [
    { what: "not a mapping", value: sql, problem: notAMapping },
    missing(statement, "sql", sqlProblem),
    given(statement, { sql: 1 }, sqlProblem),
    missing(statement, "parameters", parametersProblem),
    given(statement, { parameters: "everything" }, parametersProblem),
    given(statement, { parameters: 3 }, parametersProblem),
    given(statement, { partition: 3 }, "The field partition is given but is not text."),
    given(statement, { partition: null }, "The field partition is given but is not text."),
  ];
}

function pathCases(path: string): readonly Refused[] {
  const problem = "The field path is missing or is not text.";
  return [
    { what: "not a mapping", value: null, problem: notAMapping },
    missing({ path }, "path", problem),
    given({ path }, { path: [path] }, problem),
  ];
}

function twoTextCases(fields: Fields): readonly Refused[] {
  return [
    { what: "not a mapping", value: [], problem: notAMapping },
    ...Object.keys(fields).flatMap((name) => {
      const problem = `The field ${name} is missing or is not text.`;
      return [missing(fields, name, problem), given(fields, { [name]: 7 }, problem)];
    }),
  ];
}

const httpRequest = { method: "POST", url: "https://api.example.com/items", headers: {}, body: "x" };

const commandRequest = { command: ["git", "status"], folder: ".", timeLimitSeconds: 30, input: "y\n" };

export const refusedRequests: { readonly [Name in OperationName]: readonly Refused[] } = {
  "db.execute": statementCases("insert into items (title) values ('a')"),
  "db.query": statementCases("select 1"),
  "db.migrate": [
    { what: "not a mapping", value: "feed-briefing", problem: notAMapping },
    missing({ partition: "feed-briefing" }, "partition", "The field partition is missing or is not text."),
    given({ partition: "feed-briefing" }, { partition: 1 }, "The field partition is missing or is not text."),
  ],
  "db.agentQuery": [
    { what: "not a mapping", value: [], problem: notAMapping },
    missing({ sql: "select 1" }, "sql", "The field sql is missing or is not text."),
    given({ sql: "select 1" }, { sql: 7 }, "The field sql is missing or is not text."),
    given({ sql: "select 1" }, { partition: 7 }, "The field partition is given but is not text."),
    given({ sql: "select 1" }, { partition: null }, "The field partition is given but is not text."),
  ],
  "files.read": pathCases("notes-in/a.txt"),
  "files.list": pathCases("notes-in"),
  "files.write": twoTextCases({ path: "notes-out/a.txt", text: "hello" }),
  "files.makeFolder": pathCases(".forge/copies/k3"),
  "files.link": twoTextCases({ path: ".forge/copies/k3/node_modules", target: "node_modules" }),
  "files.remove": pathCases(".forge/copies/k3"),
  "secrets.get": twoTextCases({ name: "API_TOKEN" }),
  "http.request": [
    { what: "not a mapping", value: "https://api.example.com", problem: notAMapping },
    missing(httpRequest, "method", "The field method is missing or is not one of GET, POST, PUT, PATCH, DELETE."),
    given(
      httpRequest,
      { method: "TRACE" },
      "The field method is missing or is not one of GET, POST, PUT, PATCH, DELETE.",
    ),
    given(httpRequest, { method: 1 }, "The field method is missing or is not one of GET, POST, PUT, PATCH, DELETE."),
    missing(httpRequest, "url", "The field url is missing or is not text."),
    given(httpRequest, { url: { href: "https://api.example.com" } }, "The field url is missing or is not text."),
    missing(httpRequest, "headers", "The field headers is missing or is not a mapping of text to text."),
    given(httpRequest, { headers: ["accept"] }, "The field headers is missing or is not a mapping of text to text."),
    given(
      httpRequest,
      { headers: { "x-count": 3 } },
      "The field headers is missing or is not a mapping of text to text.",
    ),
    given(httpRequest, { body: 3 }, "The field body is given but is not text."),
    given(httpRequest, { body: null }, "The field body is given but is not text."),
  ],
  "events.emit": [
    { what: "not a mapping", value: "briefed", problem: notAMapping },
    missing({ kind: "briefed", detail: null }, "kind", "The field kind is missing or is not text."),
    given({ kind: "briefed", detail: null }, { kind: false }, "The field kind is missing or is not text."),
    missing({ kind: "briefed", detail: null }, "detail", "The field detail is missing or is not a JSON value."),
  ],
  call: [
    { what: "not a mapping", value: "store.put", problem: notAMapping },
    missing({ reference: "store.put", input: {} }, "reference", "The field reference is missing or is not text."),
    given({ reference: "store.put", input: {} }, { reference: 1 }, "The field reference is missing or is not text."),
    missing({ reference: "store.put", input: {} }, "input", "The field input is missing or is not a JSON value."),
  ],
  spend: [
    { what: "not a mapping", value: 1, problem: notAMapping },
    missing({ spending: { usd: 1 } }, "spending", "The field spending is missing or is not a JSON value."),
  ],
  "commands.run": [
    { what: "not a mapping", value: ["git", "status"], problem: notAMapping },
    missing(commandRequest, "command", "The field command is missing or is not a list of text."),
    given(commandRequest, { command: "git status" }, "The field command is missing or is not a list of text."),
    given(commandRequest, { command: ["git", 1] }, "The field command is missing or is not a list of text."),
    missing(commandRequest, "folder", "The field folder is missing or is not text."),
    given(commandRequest, { folder: ["."] }, "The field folder is missing or is not text."),
    missing(commandRequest, "timeLimitSeconds", "The field timeLimitSeconds is missing or is not a number."),
    given(commandRequest, { timeLimitSeconds: "30" }, "The field timeLimitSeconds is missing or is not a number."),
    given(commandRequest, { input: 1 }, "The field input is given but is not text."),
    given(commandRequest, { input: null }, "The field input is given but is not text."),
  ],
};

const executed = { changes: 1, lastInsertRowid: 7 };

const columnsWithRows = { columns: ["id"], rows: [[1]] };

const response = { status: 200, headers: { "content-type": "text/plain" }, body: "fine" };

const output = { text: "", cut: false };

const ran = { end: { how: "exited", exitCode: 0 }, milliseconds: 12, stdout: output, stderr: output };

function resultCases(base: Fields, problem: string, wrong: Fields): readonly Refused[] {
  return [
    { what: "not a mapping", value: [base], problem },
    { what: "null", value: null, problem },
    ...Object.keys(base).flatMap((name) => [
      missing(base, name, problem),
      given(base, { [name]: wrong[name] ?? null }, problem),
    ]),
  ];
}

function listCases(item: Json, wrongItem: Json, problem: string): readonly Refused[] {
  return [
    { what: "not a list", value: { items: [item] }, problem },
    { what: "an item of the wrong kind", value: [item, wrongItem], problem },
  ];
}

function onlyNull(): readonly Refused[] {
  return [
    { what: "false", value: false, problem: "The value is not null." },
    { what: "an empty text", value: "", problem: "The value is not null." },
    { what: "an empty mapping", value: {}, problem: "The value is not null." },
  ];
}

function onlyText(): readonly Refused[] {
  return [
    { what: "null", value: null, problem: "The value is not text." },
    { what: "a list of text", value: ["a"], problem: "The value is not text." },
  ];
}

const ranProblem = "The value is not a command's end, time and output.";

function ranWith(name: string, value: Json): Refused {
  return { what: `${name} given as ${JSON.stringify(value)}`, value: { ...ran, [name]: value }, problem: ranProblem };
}

const responseProblem = "The value is not a response with a status, headers and a body.";

export const refusedResults: { readonly [Name in Exclude<OperationName, "call">]: readonly Refused[] } = {
  "db.execute": resultCases(executed, "The value is not a count of changes with the last row id.", {
    changes: "1",
    lastInsertRowid: null,
  }),
  "db.query": listCases({ id: 1 }, [1], "The value is not a list of rows."),
  "db.migrate": listCases("0001-items.sql", 2, "The value is not a list of text."),
  "db.agentQuery": [
    ...resultCases(columnsWithRows, "The value is not columns with rows.", { columns: "id", rows: "1" }),
    {
      what: "a column that is not text",
      value: { columns: [1], rows: [] },
      problem: "The value is not columns with rows.",
    },
    {
      what: "a row that is not a list",
      value: { columns: ["id"], rows: [1] },
      problem: "The value is not columns with rows.",
    },
  ],
  "files.read": onlyText(),
  "files.list": listCases("a.txt", null, "The value is not a list of text."),
  "files.write": onlyNull(),
  "files.makeFolder": onlyNull(),
  "files.link": onlyNull(),
  "files.remove": onlyNull(),
  "secrets.get": onlyText(),
  "http.request": [
    ...resultCases(response, responseProblem, { status: "200", headers: ["content-type"], body: null }),
    given(response, { headers: { "x-count": 3 } }, responseProblem),
  ],
  "events.emit": onlyNull(),
  spend: onlyNull(),
  "commands.run": [
    ...resultCases(ran, ranProblem, { end: "exited", milliseconds: "12", stdout: "", stderr: null }),
    ranWith("end", { how: "vanished" }),
    ranWith("end", { exitCode: 0 }),
    ranWith("end", { how: "exited" }),
    ranWith("end", { how: "exited", exitCode: "0" }),
    ranWith("end", { how: "signalled" }),
    ranWith("end", { how: "signalled", signal: 15 }),
    ranWith("stdout", { cut: false }),
    ranWith("stdout", { text: 1, cut: false }),
    ranWith("stdout", { text: "" }),
    ranWith("stdout", { text: "", cut: "no" }),
    ranWith("stderr", { cut: false }),
    ranWith("stderr", { text: 1, cut: false }),
    ranWith("stderr", { text: "" }),
    ranWith("stderr", { text: "", cut: "no" }),
  ],
};
