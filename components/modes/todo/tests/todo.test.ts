import assert from "node:assert/strict";
import { test } from "node:test";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";

async function inFreshProject(body: (project: ModeProject) => Promise<void>): Promise<void> {
  const project = await openModeProject(
    { modes: ["todo"], bindings: {}, adapter: "claude-code" },
    { project: import.meta.dirname },
  );
  try {
    await body(project);
  } finally {
    await project.close();
  }
}

const emptyTextSentence = "The text is empty: write what the todo is, and add it again.";
const longTextSentence = "A todo's text may be at most 500 characters: shorten it and add it again.";
const noTodo99Sentence = "No todo has the id 99: list all todos to see the ids there are.";
const noTodo2Sentence = "No todo has the id 2: list all todos to see the ids there are.";
const alreadyDoneSentence = "Todo 1 is already done: list the open todos to see what is left to do.";

function assertSentence(reason: string, sentence: string, message: string): void {
  assert.ok(reason.includes(sentence), `${message}: ${reason}`);
}

test("adding a text gives the first todo the id 1, open", async () => {
  await inFreshProject(async (project) => {
    const added = await project.output("todo.add", { text: "buy milk" });
    assert.deepEqual(added, { id: 1, text: "buy milk", status: "open" }, "the answer should be the new open todo");
  });
});

test("a text padded with spaces is added trimmed, and listed trimmed", async () => {
  await inFreshProject(async (project) => {
    const added = await project.output("todo.add", { text: "  buy milk  " });
    assert.deepEqual(added, { id: 1, text: "buy milk", status: "open" }, "the answer should hold the trimmed text");
    const listed = await project.output("todo.list", { which: "open" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the list should hold the trimmed text",
    );
  });
});

test("a text of 500 letters is kept whole", async () => {
  await inFreshProject(async (project) => {
    const text = "a".repeat(500);
    const added = await project.output("todo.add", { text });
    assert.deepEqual(added, { id: 1, text, status: "open" }, "the longest text allowed should be kept whole");
    const listed = await project.output("todo.list", { which: "open" });
    assert.deepEqual(listed, { todos: [{ id: 1, text, status: "open" }] }, "the list should show the whole text");
  });
});

test("a text of 500 thumbs-up emoji is kept whole", async () => {
  await inFreshProject(async (project) => {
    const text = "👍".repeat(500);
    const added = await project.output("todo.add", { text });
    assert.deepEqual(added, { id: 1, text, status: "open" }, "500 emoji should be kept whole");
    const listed = await project.output("todo.list", { which: "open" });
    assert.deepEqual(listed, { todos: [{ id: 1, text, status: "open" }] }, "the list should show every emoji");
  });
});

test("a text of 500 thumbs-up emoji with a skin tone is kept whole, each counting as one character", async () => {
  await inFreshProject(async (project) => {
    const text = "👍🏽".repeat(500);
    const added = await project.output("todo.add", { text });
    assert.deepEqual(added, { id: 1, text, status: "open" }, "500 characters as a person sees them should be kept");
    const listed = await project.output("todo.list", { which: "open" });
    assert.deepEqual(listed, { todos: [{ id: 1, text, status: "open" }] }, "the list should show the whole text");
  });
});

test("a text of 500 letters padded with a space on each side is stored as the 500 letters", async () => {
  await inFreshProject(async (project) => {
    const letters = "a".repeat(500);
    const added = await project.output("todo.add", { text: ` ${letters} ` });
    assert.deepEqual(added, { id: 1, text: letters, status: "open" }, "spaces should not count toward the limit");
  });
});

test("an empty text is refused, nothing is stored, and the next add works", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    const reason = await project.failure("todo.add", { text: "" });
    assertSentence(reason, emptyTextSentence, "the refusal should tell the person what to do");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the refused text should leave the list as it was",
    );
    const next = await project.output("todo.add", { text: "call the bank" });
    assert.deepEqual(next, { id: 2, text: "call the bank", status: "open" }, "a refusal should use up no id");
  });
});

test("a text of only spaces is refused and nothing is stored", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    const reason = await project.failure("todo.add", { text: "   " });
    assertSentence(reason, emptyTextSentence, "the refusal should tell the person what to do");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the refused text should leave the list as it was",
    );
  });
});

test("a text of only a tab and a line break is refused and nothing is stored", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    const reason = await project.failure("todo.add", { text: "\t\n" });
    assertSentence(reason, emptyTextSentence, "the refusal should tell the person what to do");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the refused text should leave the list as it was",
    );
  });
});

test("a text of 501 letters is refused, nothing is stored, and the next add works", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    const reason = await project.failure("todo.add", { text: "a".repeat(501) });
    assertSentence(reason, longTextSentence, "the refusal should say how to shorten the text");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the refused text should leave the list as it was",
    );
    const next = await project.output("todo.add", { text: "call the bank" });
    assert.deepEqual(next, { id: 2, text: "call the bank", status: "open" }, "a refusal should use up no id");
  });
});

test("a text of 501 thumbs-up emoji with a skin tone is refused and nothing is stored", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    const reason = await project.failure("todo.add", { text: "👍🏽".repeat(501) });
    assertSentence(reason, longTextSentence, "the refusal should say how to shorten the text");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the refused text should leave the list as it was",
    );
  });
});

test("an id that was removed is never given to a later todo", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.add", { text: "call the bank" });
    await project.output("todo.remove", { id: 2 });
    const added = await project.output("todo.add", { text: "post the letter" });
    assert.deepEqual(added, { id: 3, text: "post the letter", status: "open" }, "the removed id should stay unused");
  });
});

test("removing the only todo does not bring the next id back to 1", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.remove", { id: 1 });
    const added = await project.output("todo.add", { text: "call the bank" });
    assert.deepEqual(added, { id: 2, text: "call the bank", status: "open" }, "the removed id should stay unused");
  });
});

test("three todos added one after another get the ids 1, 2 and 3", async () => {
  await inFreshProject(async (project) => {
    const first = await project.output("todo.add", { text: "buy milk" });
    const second = await project.output("todo.add", { text: "call the bank" });
    const third = await project.output("todo.add", { text: "post the letter" });
    assert.deepEqual(first, { id: 1, text: "buy milk", status: "open" }, "the first todo should get the first id");
    assert.deepEqual(second, { id: 2, text: "call the bank", status: "open" }, "the second todo should follow");
    assert.deepEqual(third, { id: 3, text: "post the letter", status: "open" }, "the third todo should follow");
  });
});

test("spaces and line breaks inside a text are kept, and SQL in a text is stored as text", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy  milk\nand eggs" });
    await project.output("todo.add", { text: "x'); DROP TABLE todos; --" });
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      {
        todos: [
          { id: 1, text: "buy  milk\nand eggs", status: "open" },
          { id: 2, text: "x'); DROP TABLE todos; --", status: "open" },
        ],
      },
      "inner whitespace and hostile text should be kept as text",
    );
  });
});

test("adding with no text is refused and nothing is stored", async () => {
  await inFreshProject(async (project) => {
    const refused = await project.refusal("todo.add", {});
    assert.match(refused, /text/, "the refusal should name the missing field");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(listed, { todos: [] }, "nothing should be stored after the refusal");
  });
});

test("adding a number in place of the text is refused and nothing is stored", async () => {
  await inFreshProject(async (project) => {
    const refused = await project.refusal("todo.add", { text: 5 });
    assert.match(refused, /text/, "the refusal should name the field of the wrong kind");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(listed, { todos: [] }, "nothing should be stored after the refusal");
  });
});

test("listing the open todos before anything was added gives an empty list", async () => {
  await inFreshProject(async (project) => {
    const listed = await project.output("todo.list", { which: "open" });
    assert.deepEqual(listed, { todos: [] }, "an empty project should list nothing");
  });
});

test("listing all the todos before anything was added gives an empty list", async () => {
  await inFreshProject(async (project) => {
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(listed, { todos: [] }, "an empty project should list nothing");
  });
});

test("two todos are listed in the order they were added", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.add", { text: "call the bank" });
    const listed = await project.output("todo.list", { which: "open" });
    assert.deepEqual(
      listed,
      {
        todos: [
          { id: 1, text: "buy milk", status: "open" },
          { id: 2, text: "call the bank", status: "open" },
        ],
      },
      "the todos should come in the order added",
    );
  });
});

test("a todo marked done is not listed among the open ones", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.add", { text: "call the bank" });
    await project.output("todo.done", { id: 1 });
    const listed = await project.output("todo.list", { which: "open" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 2, text: "call the bank", status: "open" }] },
      "only the open todo should be listed",
    );
  });
});

test("listing all shows a done todo between open ones, in the order added", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.add", { text: "call the bank" });
    await project.output("todo.add", { text: "post the letter" });
    await project.output("todo.done", { id: 2 });
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      {
        todos: [
          { id: 1, text: "buy milk", status: "open" },
          { id: 2, text: "call the bank", status: "done" },
          { id: 3, text: "post the letter", status: "open" },
        ],
      },
      "every todo should be listed with its status",
    );
  });
});

test("a removed todo is not listed, whichever list is asked for", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.add", { text: "call the bank" });
    await project.output("todo.remove", { id: 2 });
    const all = await project.output("todo.list", { which: "all" });
    const open = await project.output("todo.list", { which: "open" });
    const remaining = { todos: [{ id: 1, text: "buy milk", status: "open" }] };
    assert.deepEqual(all, remaining, "the full list should not hold the removed todo");
    assert.deepEqual(open, remaining, "the open list should not hold the removed todo");
  });
});

test("listing with an unknown choice of which todos is refused", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    const refused = await project.refusal("todo.list", { which: "done" });
    assert.match(refused, /which/, "the refusal should name the field");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the todos should be as they were",
    );
  });
});

test("listing with no choice of which todos is refused", async () => {
  await inFreshProject(async (project) => {
    const refused = await project.refusal("todo.list", {});
    assert.match(refused, /which/, "the refusal should name the missing field");
  });
});

test("listing leaves the todos as they were", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.list", { which: "open" });
    await project.output("todo.list", { which: "all" });
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "reading should change nothing",
    );
    const added = await project.output("todo.add", { text: "call the bank" });
    assert.deepEqual(added, { id: 2, text: "call the bank", status: "open" }, "reading should use up no id");
  });
});

test("marking a todo done answers with it done and leaves the other todo open", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.add", { text: "call the bank" });
    const done = await project.output("todo.done", { id: 1 });
    assert.deepEqual(done, { id: 1, text: "buy milk", status: "done" }, "the answer should be the todo, done");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      {
        todos: [
          { id: 1, text: "buy milk", status: "done" },
          { id: 2, text: "call the bank", status: "open" },
        ],
      },
      "only the named todo should have changed",
    );
  });
});

test("marking done an id that names no todo is refused, changes nothing, and the next call works", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    const reason = await project.failure("todo.done", { id: 99 });
    assertSentence(reason, noTodo99Sentence, "the refusal should say which id is unknown and what to do");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the refusal should change nothing",
    );
    const done = await project.output("todo.done", { id: 1 });
    assert.deepEqual(done, { id: 1, text: "buy milk", status: "done" }, "the next right call should work");
  });
});

test("marking a todo done twice is refused the second time and it stays done", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.done", { id: 1 });
    const reason = await project.failure("todo.done", { id: 1 });
    assertSentence(reason, alreadyDoneSentence, "the refusal should say the todo is already done and what to do");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "done" }] },
      "the todo should stay done",
    );
  });
});

test("marking done a todo that was removed is refused", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.add", { text: "call the bank" });
    await project.output("todo.remove", { id: 2 });
    const reason = await project.failure("todo.done", { id: 2 });
    assertSentence(reason, noTodo2Sentence, "the refusal should say the todo is gone and what to do");
  });
});

test("marking done the id 0 is refused before the action runs", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    const refused = await project.refusal("todo.done", { id: 0 });
    assert.match(refused, /id/, "the refusal should name the field");
    const listed = await project.output("todo.list", { which: "open" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the todo should be untouched",
    );
  });
});

test("marking done an id that is not a whole number is refused", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    const refused = await project.refusal("todo.done", { id: "1" });
    assert.match(refused, /id/, "the refusal should name the field of the wrong kind");
    const listed = await project.output("todo.list", { which: "open" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the todo should be untouched",
    );
  });
});

test("removing a todo answers with it and leaves the other todo", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.add", { text: "call the bank" });
    const removed = await project.output("todo.remove", { id: 2 });
    assert.deepEqual(removed, { id: 2, text: "call the bank", status: "open" }, "the answer should be the removed todo");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "only the other todo should remain",
    );
  });
});

test("removing an id that names no todo is refused, changes nothing, and uses up no id", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    const reason = await project.failure("todo.remove", { id: 99 });
    assertSentence(reason, noTodo99Sentence, "the refusal should say which id is unknown and what to do");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the refusal should change nothing",
    );
    const added = await project.output("todo.add", { text: "call the bank" });
    assert.deepEqual(added, { id: 2, text: "call the bank", status: "open" }, "the next add should work");
  });
});

test("removing the same todo twice is refused the second time", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.add", { text: "call the bank" });
    await project.output("todo.remove", { id: 2 });
    const reason = await project.failure("todo.remove", { id: 2 });
    assertSentence(reason, noTodo2Sentence, "the refusal should say the todo is gone and what to do");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the other todo should remain",
    );
  });
});

test("a todo that is done can be removed, and the answer shows it done", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    await project.output("todo.done", { id: 1 });
    const removed = await project.output("todo.remove", { id: 1 });
    assert.deepEqual(removed, { id: 1, text: "buy milk", status: "done" }, "the answer should be the todo, done");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(listed, { todos: [] }, "nothing should remain");
  });
});

test("removing the id 0 is refused before the action runs", async () => {
  await inFreshProject(async (project) => {
    await project.output("todo.add", { text: "buy milk" });
    const refused = await project.refusal("todo.remove", { id: 0 });
    assert.match(refused, /id/, "the refusal should name the field");
    const listed = await project.output("todo.list", { which: "all" });
    assert.deepEqual(
      listed,
      { todos: [{ id: 1, text: "buy milk", status: "open" }] },
      "the todo should be untouched",
    );
  });
});
