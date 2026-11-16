import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, numberField, parseJson, textField } from "../bay/json.ts";
import { bay, listOf } from "./cli-fixture.ts";
import { makeProject, type Project } from "./project-fixture.ts";

type Resources = Readonly<Record<string, unknown>>;

type Twin = {
  readonly rule: string;
  readonly broken: Resources;
  readonly valid: Resources;
};

const twins: readonly Twin[] = [
  {
    rule: "a write path into .agentbay/",
    broken: { files: { write: [".agentbay/data/"] } },
    valid: { files: { write: ["out/agentbay-data/"] } },
  },
  {
    rule: "a write path into another mode's folder",
    broken: { files: { write: ["components/modes/writer/out/"] } },
    valid: { files: { write: ["out/writer/"] } },
  },
  {
    rule: "an absolute path",
    broken: { files: { read: ["/etc/"] } },
    valid: { files: { read: ["etc/"] } },
  },
  {
    rule: "a path that climbs out with ..",
    broken: { files: { read: ["notes/../../outside/"] } },
    valid: { files: { read: ["notes/../inside/"] } },
  },
  {
    rule: "a mode writing its own scripts/",
    broken: { files: { write: ["components/modes/probe/scripts/"] } },
    valid: { files: { write: ["out/probe/scripts/"] } },
  },
  {
    rule: "a command in a project mode",
    broken: { commands: ["node --test"] },
    valid: { commands: [] },
  },
  {
    rule: "a kit folder from a mode that is not forge",
    broken: { files: { write: ["framework/"] } },
    valid: { files: { write: ["out/framework/"] } },
  },
  {
    rule: "a secret name that is not upper case",
    broken: { secrets: ["probe_token"] },
    valid: { secrets: ["PROBE_TOKEN"] },
  },
  {
    rule: "a host written as a URL",
    broken: { network: ["https://Example.com/path"] },
    valid: { network: ["api.example.com"] },
  },
  {
    rule: "a read path into .git/",
    broken: { files: { read: [".git/"] } },
    valid: { files: { read: ["git/"] } },
  },
];

async function writeProbe(project: Project, resources: Resources): Promise<void> {
  const mode = {
    name: "probe",
    version: "1.0.0",
    description: "Exists to carry the resources under test.",
    resources,
    actions: {
      look: {
        description: "When a test looks.",
        input: "schemas/anything.json",
        output: "schemas/anything.json",
        effects: ["read"],
        run: [{ script: "scripts/look.ts" }],
      },
    },
  };
  await project.write("components/modes/probe/mode.yaml", stringify(mode));
  await project.write("components/modes/probe/schemas/anything.json", '{ "type": "object" }\n');
  await project.write("components/modes/probe/tests/look.example.json", '{ "input": {}, "output": {} }\n');
  await project.write(
    "components/modes/probe/scripts/look.ts",
    'import { defineScript } from "agentbay/sdk";\n\nexport const run = defineScript(async (input) => input);\n',
  );
}

function probeErrors(json: Json): readonly Json[] {
  return listOf(fieldOf(json, "findings")).filter(
    (finding) =>
      textField(finding, "severity") === "error" &&
      (textField(finding, "file") ?? "").endsWith("components/modes/probe/mode.yaml"),
  );
}

type Verdicts = { readonly checkErrors: readonly Json[]; readonly callAccepted: boolean; readonly callText: string };

async function verdicts(project: Project): Promise<Verdicts> {
  const checked = await bay(["check", "--project", project.root, "--json"]);
  const called = await bay(["call", "greeter.fetch", '{"name":"Ada"}', "--project", project.root, "--json"]);
  return {
    checkErrors: probeErrors(parseJson(checked.output)),
    callAccepted: called.exitCode === 0,
    callText: called.output,
  };
}

test("for each policy rule, bay check reports the broken manifest and bay call refuses it; both accept its twin", async () => {
  const project = await makeProject();
  const disagreements: string[] = [];
  try {
    for (const twin of twins) {
      await writeProbe(project, twin.broken);
      const broken = await verdicts(project);
      if (broken.checkErrors.length === 0) {
        disagreements.push(`bay check passed ${twin.rule}`);
      }
      if (broken.checkErrors.some((finding) => (numberField(finding, "line") ?? 0) === 0)) {
        disagreements.push(`bay check gave no line for ${twin.rule}`);
      }
      if (broken.callAccepted) {
        disagreements.push(`bay call accepted ${twin.rule}`);
      }
      await writeProbe(project, twin.valid);
      const valid = await verdicts(project);
      if (valid.checkErrors.length > 0) {
        disagreements.push(`bay check refused the twin of ${twin.rule}: ${JSON.stringify(valid.checkErrors)}`);
      }
      if (!valid.callAccepted) {
        disagreements.push(`bay call refused the twin of ${twin.rule}: ${valid.callText}`);
      }
    }
  } finally {
    await project.remove();
  }
  assert.deepEqual(disagreements, []);
});
