import assert from "node:assert/strict";
import { test } from "node:test";
import {
  homeFolder,
  homeOf,
  isInsideOrEqual,
  isProjectTheKit,
  layoutOf,
  pathIn,
  shownPath,
  shownProblems,
} from "../bay/layout.ts";

const separate = layoutOf({ kit: "/opt/agentbay/", project: "/home/owner/notes" });

const same = layoutOf({ kit: "/work/agentbay", project: "/work/agentbay/" });

test("a layout names both folders without trailing slashes and the config file inside the project", () => {
  assert.deepEqual(separate, {
    kit: "/opt/agentbay",
    project: "/home/owner/notes",
    configFile: "/home/owner/notes/agentbay.config.yaml",
  });
  assert.equal(isProjectTheKit(separate), false);
  assert.equal(isProjectTheKit(same), true);
});

test("a path is resolved in the kit or in the project", () => {
  assert.equal(homeFolder(separate, "kit"), "/opt/agentbay");
  assert.equal(homeFolder(separate, "project"), "/home/owner/notes");
  assert.equal(pathIn(separate, "kit", "bay/templates"), "/opt/agentbay/bay/templates");
  assert.equal(pathIn(separate, "project", "components/modes"), "/home/owner/notes/components/modes");
});

test("a path's home is the deeper of the two folders that hold it", () => {
  assert.equal(homeOf(separate, "/opt/agentbay/bay/sdk.ts"), "kit");
  assert.equal(homeOf(separate, "/home/owner/notes/out"), "project");
  assert.equal(homeOf(separate, "/home/owner/notes-old/out"), undefined);
  const nested = layoutOf({ kit: "/home/owner/notes/vendor/agentbay", project: "/home/owner/notes" });
  assert.equal(homeOf(nested, "/home/owner/notes/vendor/agentbay/bay"), "kit");
  assert.equal(homeOf(nested, "/home/owner/notes/vendor/other"), "project");
  assert.equal(homeOf(same, "/work/agentbay/bay"), "project");
});

test("a path is shown relative to its folder, with kit: before kit files when the folders differ", () => {
  assert.equal(
    shownPath(separate, "/opt/agentbay/components/base/store/mode.yaml"),
    "kit:components/base/store/mode.yaml",
  );
  assert.equal(shownPath(separate, "/home/owner/notes/components/modes/journal"), "components/modes/journal");
  assert.equal(shownPath(separate, "/home/owner/notes"), ".");
  assert.equal(shownPath(separate, "/elsewhere/file"), "/elsewhere/file");
  assert.equal(shownPath(separate, "components/modes/journal"), "components/modes/journal");
  assert.equal(shownPath(same, "/work/agentbay/components/base/store"), "components/base/store");
});

test("problems keep everything but their file, which is shown", () => {
  const problem = { file: "/opt/agentbay/bay/x.ts", path: "/a", line: 3, message: "m", fix: "f" };
  assert.deepEqual(shownProblems(separate, [problem]), [{ ...problem, file: "kit:bay/x.ts" }]);
});

test("a folder holds itself and what lies below it, not a sibling sharing its prefix", () => {
  assert.ok(isInsideOrEqual("/a/b", "/a/b"));
  assert.ok(isInsideOrEqual("/a/b/c", "/a/b"));
  assert.ok(isInsideOrEqual("/a/b/c", "/a/b/"));
  assert.ok(!isInsideOrEqual("/a/bc", "/a/b"));
});
