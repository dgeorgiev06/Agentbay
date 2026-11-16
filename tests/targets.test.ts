import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveActionReference, resolveCall, resolveNamedAction, resolveOwnAction } from "../bay/targets.ts";
import { fixtureSystem } from "./runs-fixture.ts";

test("targets resolve own actions, interface calls through bindings, and say plainly what is missing", async () => {
  const { system } = await fixtureSystem();
  const notes = system.modes.get("notes");
  assert.ok(notes);
  const call = resolveCall(system, notes, "items-store.put");
  assert.ok(typeof call !== "string");
  assert.equal(call.mode.manifest.name, "store");
  assert.equal(call.name, "put");
  const own = resolveNamedAction(system, "notes", "copy");
  assert.ok(typeof own !== "string");
  assert.equal(own.mode.manifest.name, "notes");
  assert.equal(
    resolveCall(system, notes, "mail.fetch"),
    "Mode notes calls mail.fetch, but it does not require the interface mail.",
  );
  assert.equal(
    resolveCall(system, notes, "put"),
    "put does not name an action of an interface; write <interface>.<action>.",
  );
  const unbound = { ...system, config: { ...system.config, bindings: {} } };
  assert.equal(
    resolveCall(unbound, notes, "items-store.put"),
    "Mode notes calls items-store.put, but no mode is bound to items-store@1 for it.",
  );
  assert.equal(resolveActionReference(system, "notes"), "notes does not name an action; write <mode>.<action>.");
  const reserved = resolveOwnAction(system, "notes", "constructor");
  assert.ok(typeof reserved === "string");
  assert.match(reserved, /has no action constructor/);
  assert.equal(resolveOwnAction(system, "ghost", "x"), "There is no mode ghost.");
});
