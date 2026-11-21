import type { Json } from "../../../bay/contracts.ts";
import type { OperationName } from "../../../bay/broker/operations.ts";

export type Refused = { readonly what: string; readonly value: Json; readonly sentence: string };

type Fields = { readonly [key: string]: Json };

function without(fields: Fields, name: string): Fields {
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key !== name));
}

function requestFor(operation: OperationName): string {
  return `request for ${operation}`;
}

function answerTo(operation: OperationName): string {
  return `answer to ${operation}`;
}

function wholeIsNot(subject: string, expected: string): string {
  return `The ${subject} is not ${expected}.`;
}

function fieldIsMissing(subject: string, field: string, expected: string): string {
  return `The field ${field} is missing from the ${subject}. It must be ${expected}.`;
}

function fieldIsNot(subject: string, field: string, expected: string): string {
  return `The field ${field} in the ${subject} is not ${expected}.`;
}

function itemIsNot(subject: string, item: string, expected: string): string {
  return `The item ${item} in the ${subject} is not ${expected}.`;
}

function fieldIsUnknown(subject: string, field: string, taken: string): string {
  return `The field ${field} in the ${subject} is not one it takes. It takes ${taken}.`;
}

function notAMapping(operation: OperationName, value: Json): Refused {
  return { what: "not a mapping", value, sentence: wholeIsNot(requestFor(operation), "a mapping") };
}

function missing(fields: Fields, name: string, sentence: string): Refused {
  return { what: `${name} missing`, value: without(fields, name), sentence };
}

function given(fields: Fields, change: Fields, sentence: string): Refused {
  const what = Object.entries(change).map(([name, value]) => `${name} given as ${JSON.stringify(value)}`);
  return { what: what.join(", "), value: { ...fields, ...change }, sentence };
}

function statementCases(operation: "db.execute" | "db.query", sql: string): readonly Refused[] {
  const statement = { sql, parameters: [], partition: "feed-briefing" };
  const request = requestFor(operation);
  const parameters = "a list or a mapping";
  return [
    notAMapping(operation, sql),
    missing(statement, "sql", fieldIsMissing(request, "sql", "text")),
    given(statement, { sql: 1 }, fieldIsNot(request, "sql", "text")),
    missing(statement, "parameters", fieldIsMissing(request, "parameters", parameters)),
    given(statement, { parameters: "everything" }, fieldIsNot(request, "parameters", parameters)),
    given(statement, { parameters: 3 }, fieldIsNot(request, "parameters", parameters)),
    given(statement, { partition: 3 }, fieldIsNot(request, "partition", "text")),
    given(statement, { partition: null }, fieldIsNot(request, "partition", "text")),
    given(statement, { params: [] }, fieldIsUnknown(request, "params", "the fields sql, parameters and partition")),
  ];
}

function pathCases(operation: OperationName, path: string): readonly Refused[] {
  const request = requestFor(operation);
  return [
    notAMapping(operation, null),
    missing({ path }, "path", fieldIsMissing(request, "path", "text")),
    given({ path }, { path: [path] }, fieldIsNot(request, "path", "text")),
    given({ path }, { text: "extra" }, fieldIsUnknown(request, "text", "the field path")),
  ];
}

function twoTextCases(operation: OperationName, fields: Fields): readonly Refused[] {
  const request = requestFor(operation);
  const names = Object.keys(fields);
  const taken = names.length === 1 ? `the field ${names.join("")}` : `the fields ${names.join(" and ")}`;
  return [
    notAMapping(operation, []),
    ...names.flatMap((name) => [
      missing(fields, name, fieldIsMissing(request, name, "text")),
      given(fields, { [name]: 7 }, fieldIsNot(request, name, "text")),
    ]),
    given(fields, { mode: "x" }, fieldIsUnknown(request, "mode", taken)),
  ];
}

const httpRequest = { method: "POST", url: "https://api.example.com/items", headers: {}, body: "x" };

const httpMethods = "one of GET, POST, PUT, PATCH, DELETE";

const httpFields = "the fields method, url, headers and body";

const commandRequest = { name: "changes", arguments: ["--short"], folder: ".", timeLimitSeconds: 30, input: "y\n" };

const commandFields = "the fields name, arguments, folder, timeLimitSeconds and input";

const http = requestFor("http.request");

const command = requestFor("commands.run");

export const refusedRequests: { readonly [Name in OperationName]: readonly Refused[] } = {
  "db.execute": statementCases("db.execute", "insert into items (title) values ('a')"),
  "db.query": statementCases("db.query", "select 1"),
  "db.migrate": [
    notAMapping("db.migrate", "feed-briefing"),
    missing({ partition: "feed-briefing" }, "partition", fieldIsMissing(requestFor("db.migrate"), "partition", "text")),
    given({ partition: "feed-briefing" }, { partition: 1 }, fieldIsNot(requestFor("db.migrate"), "partition", "text")),
  ],
  "db.agentQuery": [
    notAMapping("db.agentQuery", []),
    missing({ sql: "select 1" }, "sql", fieldIsMissing(requestFor("db.agentQuery"), "sql", "text")),
    given({ sql: "select 1" }, { sql: 7 }, fieldIsNot(requestFor("db.agentQuery"), "sql", "text")),
    given({ sql: "select 1" }, { partition: 7 }, fieldIsNot(requestFor("db.agentQuery"), "partition", "text")),
    given({ sql: "select 1" }, { partition: null }, fieldIsNot(requestFor("db.agentQuery"), "partition", "text")),
    given(
      { sql: "select 1" },
      { parameters: [] },
      fieldIsUnknown(requestFor("db.agentQuery"), "parameters", "the fields sql and partition"),
    ),
  ],
  "files.read": pathCases("files.read", "notes-in/a.txt"),
  "files.list": pathCases("files.list", "notes-in"),
  "files.write": twoTextCases("files.write", { path: "notes-out/a.txt", text: "hello" }),
  "files.makeFolder": pathCases("files.makeFolder", ".forge/copies/k3"),
  "files.link": twoTextCases("files.link", { path: ".forge/copies/k3/node_modules", target: "node_modules" }),
  "files.remove": pathCases("files.remove", ".forge/copies/k3"),
  "secrets.get": twoTextCases("secrets.get", { name: "API_TOKEN" }),
  "schemas.read": twoTextCases("schemas.read", { schema: "schemas/plan.json" }),
  "http.request": [
    notAMapping("http.request", "https://api.example.com"),
    missing(httpRequest, "method", fieldIsMissing(http, "method", httpMethods)),
    given(httpRequest, { method: "TRACE" }, fieldIsNot(http, "method", httpMethods)),
    given(httpRequest, { method: 1 }, fieldIsNot(http, "method", httpMethods)),
    missing(httpRequest, "url", fieldIsMissing(http, "url", "text")),
    given(httpRequest, { url: { href: "https://api.example.com" } }, fieldIsNot(http, "url", "text")),
    missing(httpRequest, "headers", fieldIsMissing(http, "headers", "a mapping of text to text")),
    given(httpRequest, { headers: ["accept"] }, fieldIsNot(http, "headers", "a mapping of text to text")),
    given(
      httpRequest,
      { headers: { accept: "text/plain", "x-count": 3 } },
      fieldIsNot(http, 'headers["x-count"]', "text"),
    ),
    given(httpRequest, { headers: { accept: null } }, fieldIsNot(http, "headers.accept", "text")),
    given(httpRequest, { body: 3 }, fieldIsNot(http, "body", "text")),
    given(httpRequest, { body: null }, fieldIsNot(http, "body", "text")),
    given(httpRequest, { timeout: 5 }, fieldIsUnknown(http, "timeout", httpFields)),
  ],
  "events.emit": [
    notAMapping("events.emit", "briefed"),
    missing({ kind: "briefed", detail: null }, "kind", fieldIsMissing(requestFor("events.emit"), "kind", "text")),
    given({ kind: "briefed", detail: null }, { kind: false }, fieldIsNot(requestFor("events.emit"), "kind", "text")),
    missing(
      { kind: "briefed", detail: null },
      "detail",
      fieldIsMissing(requestFor("events.emit"), "detail", "a JSON value"),
    ),
    given(
      { kind: "briefed", detail: null },
      { level: "info" },
      fieldIsUnknown(requestFor("events.emit"), "level", "the fields kind and detail"),
    ),
  ],
  call: [
    notAMapping("call", "store.put"),
    missing(
      { reference: "store.put", input: {} },
      "reference",
      fieldIsMissing(requestFor("call"), "reference", "text"),
    ),
    given({ reference: "store.put", input: {} }, { reference: 1 }, fieldIsNot(requestFor("call"), "reference", "text")),
    missing(
      { reference: "store.put", input: {} },
      "input",
      fieldIsMissing(requestFor("call"), "input", "a JSON value"),
    ),
  ],
  spend: [
    notAMapping("spend", 1),
    missing({ spending: { usd: 1 } }, "spending", fieldIsMissing(requestFor("spend"), "spending", "a JSON value")),
  ],
  random: [
    notAMapping("random", 16),
    missing({ bytes: 16 }, "bytes", fieldIsMissing(requestFor("random"), "bytes", "a number")),
    given({ bytes: 16 }, { bytes: "16" }, fieldIsNot(requestFor("random"), "bytes", "a number")),
    given({ bytes: 16 }, { seed: 1 }, fieldIsUnknown(requestFor("random"), "seed", "the field bytes")),
  ],
  "commands.run": [
    notAMapping("commands.run", ["git", "status"]),
    missing(commandRequest, "name", fieldIsMissing(command, "name", "text")),
    given(commandRequest, { name: ["changes"] }, fieldIsNot(command, "name", "text")),
    missing(commandRequest, "arguments", fieldIsMissing(command, "arguments", "a list of text")),
    given(commandRequest, { arguments: "--short" }, fieldIsNot(command, "arguments", "a list of text")),
    given(commandRequest, { arguments: ["--short", 1] }, fieldIsNot(command, "arguments[1]", "text")),
    missing(commandRequest, "folder", fieldIsMissing(command, "folder", "text")),
    given(commandRequest, { folder: ["."] }, fieldIsNot(command, "folder", "text")),
    missing(commandRequest, "timeLimitSeconds", fieldIsMissing(command, "timeLimitSeconds", "a number")),
    given(commandRequest, { timeLimitSeconds: "30" }, fieldIsNot(command, "timeLimitSeconds", "a number")),
    given(commandRequest, { input: 1 }, fieldIsNot(command, "input", "text")),
    given(commandRequest, { input: null }, fieldIsNot(command, "input", "text")),
    given(commandRequest, { command: ["git", "status"] }, fieldIsUnknown(command, "command", commandFields)),
  ],
};

const executed = { changes: 1, lastInsertRowid: 7 };

const columnsWithRows = { columns: ["id"], rows: [[1]] };

const response = { status: 200, headers: { "content-type": "text/plain" }, body: "fine" };

const output = { text: "", cut: false };

const ran = { end: { how: "exited", exitCode: 0 }, milliseconds: 12, stdout: output, stderr: output };

function answerCase(what: string, value: Json, sentence: string): Refused {
  return { what, value, sentence };
}

const validSchema = { state: "valid", schema: { type: "object" }, parts: {} };

const schemaAnswer = answerTo("schemas.read");

const schemaStates = "one of missing, invalid, unfollowed, valid";

function onlyNull(operation: OperationName): readonly Refused[] {
  const sentence = wholeIsNot(answerTo(operation), "null");
  return [
    answerCase("false", false, sentence),
    answerCase("an empty text", "", sentence),
    answerCase("an empty mapping", {}, sentence),
  ];
}

function onlyText(operation: OperationName): readonly Refused[] {
  const sentence = wholeIsNot(answerTo(operation), "text");
  return [answerCase("null", null, sentence), answerCase("a list of text", ["a"], sentence)];
}

function textList(operation: OperationName, item: Json): readonly Refused[] {
  const answer = answerTo(operation);
  return [
    answerCase("not a list", { items: [item] }, wholeIsNot(answer, "a list of text")),
    answerCase("an item of the wrong kind", [item, 2], itemIsNot(answer, "[1]", "text")),
  ];
}

const executeAnswer = answerTo("db.execute");

const agentQueryAnswer = answerTo("db.agentQuery");

const httpAnswer = answerTo("http.request");

const commandAnswer = answerTo("commands.run");

function ranWith(name: string, value: Json, sentence: string): Refused {
  return given(ran, { [name]: value }, sentence);
}

function outputCases(name: "stdout" | "stderr"): readonly Refused[] {
  return [
    ranWith(name, "", fieldIsNot(commandAnswer, name, "a mapping")),
    ranWith(name, { cut: false }, fieldIsMissing(commandAnswer, `${name}.text`, "text")),
    ranWith(name, { text: 1, cut: false }, fieldIsNot(commandAnswer, `${name}.text`, "text")),
    ranWith(name, { text: "" }, fieldIsMissing(commandAnswer, `${name}.cut`, "true or false")),
    ranWith(name, { text: "", cut: "no" }, fieldIsNot(commandAnswer, `${name}.cut`, "true or false")),
  ];
}

const endHows = "one of exited, signalled, timed-out";

export const refusedResults: { readonly [Name in Exclude<OperationName, "call">]: readonly Refused[] } = {
  "db.execute": [
    answerCase("not a mapping", [executed], wholeIsNot(executeAnswer, "a mapping")),
    answerCase("null", null, wholeIsNot(executeAnswer, "a mapping")),
    missing(executed, "changes", fieldIsMissing(executeAnswer, "changes", "a number")),
    given(executed, { changes: "1" }, fieldIsNot(executeAnswer, "changes", "a number")),
    missing(executed, "lastInsertRowid", fieldIsMissing(executeAnswer, "lastInsertRowid", "a number")),
    given(executed, { lastInsertRowid: null }, fieldIsNot(executeAnswer, "lastInsertRowid", "a number")),
  ],
  "db.query": [
    answerCase("not a list", { items: [{ id: 1 }] }, wholeIsNot(answerTo("db.query"), "a list of rows")),
    answerCase("an item of the wrong kind", [{ id: 1 }, [1]], itemIsNot(answerTo("db.query"), "[1]", "a row")),
  ],
  "db.migrate": textList("db.migrate", "0001-items.sql"),
  "db.agentQuery": [
    answerCase("not a mapping", [columnsWithRows], wholeIsNot(agentQueryAnswer, "a mapping")),
    answerCase("null", null, wholeIsNot(agentQueryAnswer, "a mapping")),
    missing(columnsWithRows, "columns", fieldIsMissing(agentQueryAnswer, "columns", "a list of text")),
    given(columnsWithRows, { columns: "id" }, fieldIsNot(agentQueryAnswer, "columns", "a list of text")),
    given(columnsWithRows, { columns: [1] }, fieldIsNot(agentQueryAnswer, "columns[0]", "text")),
    missing(columnsWithRows, "rows", fieldIsMissing(agentQueryAnswer, "rows", "a list of lists")),
    given(columnsWithRows, { rows: "1" }, fieldIsNot(agentQueryAnswer, "rows", "a list of lists")),
    given(columnsWithRows, { rows: [[1], 1] }, fieldIsNot(agentQueryAnswer, "rows[1]", "a list")),
  ],
  "files.read": onlyText("files.read"),
  "files.list": textList("files.list", "a.txt"),
  "files.write": onlyNull("files.write"),
  "files.makeFolder": onlyNull("files.makeFolder"),
  "files.link": onlyNull("files.link"),
  "files.remove": onlyNull("files.remove"),
  "secrets.get": onlyText("secrets.get"),
  "schemas.read": [
    answerCase("not a mapping", [validSchema], wholeIsNot(schemaAnswer, "a mapping")),
    given(validSchema, { state: "fine" }, fieldIsNot(schemaAnswer, "state", schemaStates)),
    missing(validSchema, "schema", fieldIsMissing(schemaAnswer, "schema", "a JSON value")),
    given(validSchema, { parts: [] }, fieldIsNot(schemaAnswer, "parts", "a mapping")),
    answerCase("invalid with no reason", { state: "invalid" }, fieldIsMissing(schemaAnswer, "reason", "text")),
    answerCase(
      "unfollowed with a reference that has no fix",
      { state: "unfollowed", references: [{ clause: "refers to x" }] },
      fieldIsNot(schemaAnswer, "references[0]", "a reference with a clause and a fix"),
    ),
  ],
  "http.request": [
    answerCase("not a mapping", [response], wholeIsNot(httpAnswer, "a mapping")),
    answerCase("null", null, wholeIsNot(httpAnswer, "a mapping")),
    missing(response, "status", fieldIsMissing(httpAnswer, "status", "a number")),
    given(response, { status: "200" }, fieldIsNot(httpAnswer, "status", "a number")),
    missing(response, "headers", fieldIsMissing(httpAnswer, "headers", "a mapping of text to text")),
    given(response, { headers: ["content-type"] }, fieldIsNot(httpAnswer, "headers", "a mapping of text to text")),
    given(response, { headers: { "x-count": 3 } }, fieldIsNot(httpAnswer, 'headers["x-count"]', "text")),
    missing(response, "body", fieldIsMissing(httpAnswer, "body", "text")),
    given(response, { body: null }, fieldIsNot(httpAnswer, "body", "text")),
  ],
  "events.emit": onlyNull("events.emit"),
  spend: onlyNull("spend"),
  random: onlyText("random"),
  "commands.run": [
    answerCase("not a mapping", [ran], wholeIsNot(commandAnswer, "a mapping")),
    answerCase("null", null, wholeIsNot(commandAnswer, "a mapping")),
    missing(ran, "end", fieldIsMissing(commandAnswer, "end", "a mapping")),
    ranWith("end", "exited", fieldIsNot(commandAnswer, "end", "a mapping")),
    ranWith("end", { how: "vanished" }, fieldIsNot(commandAnswer, "end.how", endHows)),
    ranWith("end", { exitCode: 0 }, fieldIsMissing(commandAnswer, "end.how", endHows)),
    ranWith("end", { how: "exited" }, fieldIsMissing(commandAnswer, "end.exitCode", "a number")),
    ranWith("end", { how: "exited", exitCode: "0" }, fieldIsNot(commandAnswer, "end.exitCode", "a number")),
    ranWith("end", { how: "signalled" }, fieldIsMissing(commandAnswer, "end.signal", "text")),
    ranWith("end", { how: "signalled", signal: 15 }, fieldIsNot(commandAnswer, "end.signal", "text")),
    missing(ran, "milliseconds", fieldIsMissing(commandAnswer, "milliseconds", "a number")),
    ranWith("milliseconds", "12", fieldIsNot(commandAnswer, "milliseconds", "a number")),
    missing(ran, "stdout", fieldIsMissing(commandAnswer, "stdout", "a mapping")),
    ...outputCases("stdout"),
    missing(ran, "stderr", fieldIsMissing(commandAnswer, "stderr", "a mapping")),
    ...outputCases("stderr"),
  ],
};
