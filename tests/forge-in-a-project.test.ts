import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { stringify } from "yaml";
import { fieldOf, numberField, parseJson, textField, toJson } from "../bay/json.ts";
import { fieldsOf, readYaml, type Json } from "../bay/sdk.ts";
import { kit } from "./project-fixture.ts";

type Finding = {
  readonly severity: string;
  readonly message: string;
};

type Checked = {
  readonly errors: number;
  readonly warnings: number;
  readonly findings: readonly Finding[];
};

type Files = Readonly<Record<string, string>>;

const cli = join(kit, "bay", "cli.ts");

const projects: string[] = [];

const noToolchain =
  "Forge is active and no mode is bound to toolchain@1: forge brings proof and git-worktrees, " +
  "but not a toolchain, since a project names its own.";

const broughtProof = "Forge brings the mode proof, bound to proof@1, since the config binds no mode to proof.";

const broughtWorktrees =
  "Forge brings the mode git-worktrees, bound to worktrees@1, since the config binds no mode to worktrees.";

const shelfUntrusted =
  "Mode shelf lists 1 command, and the owner does not trust the list of mode shelf, so none of it is granted.";

after(async () => {
  await Promise.all(projects.map((folder) => rm(folder, { recursive: true, force: true })));
});

function bay(folder: string, words: readonly string[]): string {
  const ran = spawnSync(process.execPath, [cli, ...words, "--json"], { cwd: folder, encoding: "utf8" });
  return ran.stdout;
}

function listField(value: Json | undefined, name: string): readonly Json[] {
  const field = value === undefined ? undefined : fieldOf(value, name);
  return Array.isArray(field) ? field.map(toJson) : [];
}

function checked(folder: string): Checked {
  const report = parseJson(bay(folder, ["check"]));
  const findings = listField(report, "findings").map((finding) => ({
    severity: textField(finding, "severity") ?? "",
    message: textField(finding, "message") ?? "",
  }));
  return { errors: numberField(report, "errors") ?? -1, warnings: numberField(report, "warnings") ?? -1, findings };
}

function activeModes(folder: string): readonly string[] {
  const listed = parseJson(bay(folder, ["actions"]));
  assert.equal(fieldOf(listed, "ok"), true, JSON.stringify(listed));
  return listField(listed, "modes")
    .map((mode) => textField(mode, "name") ?? "")
    .sort();
}

function messages(report: Checked): readonly string[] {
  return report.findings.map((finding) => finding.message);
}

function errorsOf(report: Checked): readonly string[] {
  return report.findings.filter((finding) => finding.severity === "error").map((finding) => finding.message);
}

async function projectWith(config: object, files: Files = {}): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "agentbay-forge-project-")));
  projects.push(folder);
  execFileSync("git", ["init", "-q"], { cwd: folder });
  const all = { "agentbay.config.yaml": stringify({ adapter: "fake", ...config }), ...files };
  for (const [path, text] of Object.entries(all)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), text, "utf8");
  }
  return folder;
}

async function shelfFiles(): Promise<Files> {
  const definition = await readFile(join(kit, "components", "base", "interfaces", "worktrees.yaml"), "utf8");
  const read = readYaml(definition);
  assert.ok(read.ok, definition);
  const actions = fieldsOf(fieldOf(read.value, "actions") ?? null);
  const manifest = {
    name: "shelf",
    version: "1.0.0",
    description: "Stands in for a worktrees mode of the project's own.",
    implements: ["worktrees@1"],
    resources: { commands: { "list-files": { run: "ls --", effects: ["read"] } } },
    actions: Object.fromEntries(
      Object.entries(actions).map(([name, action]) => [
        name,
        {
          description: `When a caller asks the shelf to ${name}.`,
          effects: fieldOf(action, "effects"),
          run: [{ script: "scripts/refuse.ts" }],
        },
      ]),
    ),
  };
  return {
    "components/modes/shelf/mode.yaml": stringify(manifest),
    "components/modes/shelf/scripts/refuse.ts":
      'import { defineScript, fail } from "agentbay/sdk";\n\n' +
      'export const run = defineScript(() => Promise.resolve(fail("The shelf only stands in.")));\n',
  };
}

const onePlan = {
  title: "One slice",
  slices: [
    {
      title: "The slice A",
      slice: {
        name: "A",
        kind: "mode",
        scope: ["a/**"],
        after: [],
        done: [{ id: "DOD-A", says: "A works.", level: "must" }],
      },
    },
  ],
};

test("the kit's own bay check gives 0 errors and 48 warnings: none more for forge leaving the kit, two for the typescript mode's run", () => {
  const report = checked(kit);
  assert.equal(report.errors, 0, errorsOf(report).join("\n"));
  assert.equal(report.warnings, 48, messages(report).join("\n"));
});

test("a project that lists only forge and binds a toolchain checks with no error, and forge.waves works out a plan in it", async () => {
  const plan = { "docs/plans/one.yaml": stringify(onePlan) };
  const folder = await projectWith({ modes: ["forge"], bindings: { toolchain: "typescript" } }, plan);
  const report = checked(folder);
  assert.equal(report.errors, 0, errorsOf(report).join("\n"));
  const ran = parseJson(bay(folder, ["call", "forge.waves", JSON.stringify({ plan: "docs/plans/one.yaml" })]));
  const run = fieldOf(ran, "run") ?? null;
  assert.equal(textField(run, "status"), "done", JSON.stringify(ran));
  const output = fieldOf(run, "output") ?? null;
  assert.equal(textField(output, "answer"), "worked out");
  assert.deepEqual(fieldOf(output, "waves"), [{ wave: 1, slices: ["A"], builders: 1 }]);
});

test("forge brings proof and git-worktrees, active and bound, though the config names neither, and says so", async () => {
  const folder = await projectWith({ modes: ["forge"], bindings: { toolchain: "typescript" } });
  assert.deepEqual(activeModes(folder), ["forge", "git-worktrees", "proof", "typescript"]);
  const brought = messages(checked(folder)).filter((message) => message.startsWith("Forge brings"));
  assert.deepEqual(brought, [broughtProof, broughtWorktrees]);
  const uses = listField(parseJson(bay(folder, ["config"])), "bindings");
  const bound = uses
    .map((use) => `${textField(use, "interfaceName") ?? ""} ${textField(use, "servedBy") ?? ""}`)
    .sort();
  assert.deepEqual(bound, ["proof proof", "toolchain typescript", "worktrees git-worktrees"]);
});

test("a config that binds another mode to worktrees@1 wins, and git-worktrees is then not brought", async () => {
  const bindings = { toolchain: "typescript", worktrees: "shelf" };
  const folder = await projectWith({ modes: ["forge"], bindings }, await shelfFiles());
  assert.deepEqual(activeModes(folder), ["forge", "proof", "shelf", "typescript"]);
  const brought = messages(checked(folder)).filter((message) => message.startsWith("Forge brings"));
  assert.deepEqual(brought, [broughtProof]);
});

test("with no mode bound to toolchain@1, bay check says plainly that forge does not bring one", async () => {
  const folder = await projectWith({ modes: ["forge"], bindings: {} });
  const report = checked(folder);
  assert.ok(errorsOf(report).includes(noToolchain), errorsOf(report).join("\n"));
  assert.ok(!messages(report).some((message) => message.startsWith("Mode typescript lists")));
});

test("a project that does not list forge gets none of forge, proof and git-worktrees", async () => {
  const folder = await projectWith({ modes: ["typescript"], bindings: {} });
  assert.deepEqual(activeModes(folder), ["typescript"]);
  const report = checked(folder);
  assert.equal(report.errors, 0, errorsOf(report).join("\n"));
  assert.ok(!messages(report).some((message) => message.startsWith("Forge brings")));
  assert.ok(!messages(report).includes(noToolchain));
});

test("beside forge, a project mode's listed command still needs the owner's trust, and a base mode's does not", async () => {
  const bindings = { toolchain: "typescript", worktrees: "shelf" };
  const folder = await projectWith({ modes: ["forge"], bindings }, await shelfFiles());
  const found = messages(checked(folder));
  assert.ok(found.includes(shelfUntrusted), found.join("\n"));
  const proofCommand = found.find((message) => message.startsWith("Mode proof lists the command count-lines"));
  assert.ok(proofCommand !== undefined, found.join("\n"));
  assert.ok(!found.some((message) => message.includes("does not trust the list of mode proof")));
  assert.ok(!found.some((message) => message.includes("does not trust the list of mode typescript")));
  await assert.rejects(access(join(folder, ".agentbay", "trust.json")));
});
