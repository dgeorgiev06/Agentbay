import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldOf, textField } from "../bay/json.ts";
import { ranCommands, withCommandKernel } from "./commands-fixture.ts";

test("a script of a base mode runs a command its mode lists and gets the exit code and output", async () => {
  await withCommandKernel({ commands: ["node --version"] }, async (kernel) => {
    const ran = await ranCommands(kernel, [{ command: ["node", "--version"] }]);
    const answer = ran.answers[0] ?? null;
    assert.equal(fieldOf(answer, "ok"), true, JSON.stringify(answer));
    const value = fieldOf(answer, "value") ?? null;
    assert.deepEqual(fieldOf(value, "end"), { how: "exited", exitCode: 0 });
    assert.match(textField(fieldOf(value, "stdout") ?? null, "text") ?? "", /^v\d+\.\d+\.\d+\n$/);
  });
});
