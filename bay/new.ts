import { join } from "node:path/posix";
import { isMap, isScalar, isSeq, parseDocument, type Document } from "yaml";
import type { FileSystem } from "./ports.ts";
import type { Outcome, Problem } from "./spec.ts";

export type ModeTier = "base" | "modes";

export type Workspace = {
  readonly files: FileSystem;
  readonly root: string;
};

export type Generated = Outcome<readonly string[]>;

type PlannedFile = {
  readonly path: string;
  readonly text: string;
  readonly edit: boolean;
};

type Planned = Outcome<readonly PlannedFile[]>;

type Slots = Readonly<Record<string, string>>;

type TemplateUse = {
  readonly template: string;
  readonly path: string;
  readonly slots: Slots;
};

type ManifestEdit = (document: Document, manifest: string) => Problem | undefined;

type ModePart = {
  readonly mode: string;
  readonly kind: string;
  readonly name: string;
};

const templatesFolder = "bay/templates";

const interfacesFolder = "components/base/interfaces";

const tierFolders: { readonly [Tier in ModeTier]: string } = {
  base: "components/base",
  modes: "components/modes",
};

const namePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const leftoverSlotPattern = /\{\{[a-z]+\}\}/;

function problem(file: string, message: string, fix: string): Problem {
  return { file, path: "", message, fix };
}

function refused(problems: readonly Problem[]): { readonly ok: false; readonly problems: readonly Problem[] } {
  return { ok: false, problems };
}

function nameProblems(kind: string, name: string, file: string): readonly Problem[] {
  if (name === "constructor") {
    return [
      problem(
        file,
        `The ${kind} name constructor is reserved, because every JavaScript object has it.`,
        "Choose another name.",
      ),
    ];
  }
  if (namePattern.test(name)) {
    return [];
  }
  return [
    problem(
      file,
      `The ${kind} name ${JSON.stringify(name)} is not kebab-case.`,
      "Start with a lowercase letter and use only lowercase letters, digits and single dashes, such as daily-digest.",
    ),
  ];
}

function fill(text: string, slots: Slots): string {
  return Object.entries(slots).reduce((filled, [slot, value]) => filled.replaceAll(`{{${slot}}}`, value), text);
}

async function render(workspace: Workspace, use: TemplateUse): Promise<Outcome<PlannedFile>> {
  const templateFile = join(templatesFolder, use.template);
  const text = await workspace.files.readText(join(workspace.root, templateFile));
  if (text === undefined) {
    return refused([problem(templateFile, `The template ${templateFile} is missing.`, "Restore it from the kit.")]);
  }
  const filled = fill(text, use.slots);
  const leftover = leftoverSlotPattern.exec(filled)?.[0];
  if (leftover !== undefined) {
    return refused([
      problem(templateFile, `The template ${templateFile} has the unfilled slot ${leftover}.`, "Correct the template."),
    ]);
  }
  return { ok: true, value: { path: use.path, text: filled, edit: false } };
}

async function renderAll(workspace: Workspace, uses: readonly TemplateUse[]): Promise<Planned> {
  const planned: PlannedFile[] = [];
  const problems: Problem[] = [];
  for (const use of uses) {
    const outcome = await render(workspace, use);
    if (outcome.ok) {
      planned.push(outcome.value);
    } else {
      problems.push(...outcome.problems);
    }
  }
  return problems.length > 0 ? refused(problems) : { ok: true, value: planned };
}

async function existingProblems(workspace: Workspace, planned: readonly PlannedFile[]): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const file of planned.filter((entry) => !entry.edit)) {
    if (await workspace.files.exists(join(workspace.root, file.path))) {
      problems.push(
        problem(file.path, `${file.path} already exists; bay new never overwrites a file.`, "Choose another name."),
      );
    }
  }
  return problems;
}

async function writePlanned(workspace: Workspace, planned: Planned): Promise<Generated> {
  if (!planned.ok) {
    return planned;
  }
  const existing = await existingProblems(workspace, planned.value);
  if (existing.length > 0) {
    return refused(existing);
  }
  for (const file of planned.value) {
    await workspace.files.writeAtomic(join(workspace.root, file.path), file.text);
  }
  return { ok: true, value: planned.value.map((file) => file.path) };
}

async function modeFolderOf(workspace: Workspace, mode: string): Promise<string | undefined> {
  for (const tierFolder of Object.values(tierFolders)) {
    const folder = join(tierFolder, mode);
    if (await workspace.files.exists(join(workspace.root, folder, "mode.yaml"))) {
      return folder;
    }
  }
  return undefined;
}

async function existingModeProblems(workspace: Workspace, name: string): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const tierFolder of Object.values(tierFolders)) {
    const folder = join(tierFolder, name);
    if (await workspace.files.exists(join(workspace.root, folder))) {
      problems.push(
        problem(folder, `${folder} already exists; every mode needs its own name.`, "Choose another name."),
      );
    }
  }
  return problems;
}

export async function newMode(workspace: Workspace, name: string, tier: ModeTier): Promise<Generated> {
  const folder = join(tierFolders[tier], name);
  const refusals = nameProblems("mode", name, folder);
  if (refusals.length > 0) {
    return refused(refusals);
  }
  const existing = await existingModeProblems(workspace, name);
  if (existing.length > 0) {
    return refused(existing);
  }
  const planned = await renderAll(workspace, [
    { template: "mode/mode.yaml", path: join(folder, "mode.yaml"), slots: { name } },
    { template: "mode/README.md", path: join(folder, "README.md"), slots: { name } },
  ]);
  return writePlanned(workspace, planned);
}

async function modeTarget(workspace: Workspace, mode: string): Promise<Outcome<string>> {
  const folder = await modeFolderOf(workspace, mode);
  if (folder === undefined) {
    const where = `${tierFolders.base}/${mode} or ${tierFolders.modes}/${mode}`;
    return refused([
      problem(
        "components",
        `There is no mode ${mode}: neither ${where} has a mode.yaml.`,
        "Name an existing mode, or create it with bay new mode.",
      ),
    ]);
  }
  return { ok: true, value: folder };
}

async function editManifest(workspace: Workspace, folder: string, edit: ManifestEdit): Promise<Outcome<PlannedFile>> {
  const manifest = join(folder, "mode.yaml");
  const text = (await workspace.files.readText(join(workspace.root, manifest))) ?? "";
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    return refused([problem(manifest, `${manifest} cannot be read as YAML.`, "Correct it, then run bay new again.")]);
  }
  const refusal = edit(document, manifest);
  if (refusal !== undefined) {
    return refused([refusal]);
  }
  return { ok: true, value: { path: manifest, text: document.toString(), edit: true } };
}

function withManifest(planned: Planned, manifest: Outcome<PlannedFile>): Planned {
  if (!manifest.ok) {
    return planned.ok ? manifest : refused([...planned.problems, ...manifest.problems]);
  }
  return planned.ok ? { ok: true, value: [...planned.value, manifest.value] } : planned;
}

function blockMapAt(document: Document, key: string): void {
  const node = document.get(key, true);
  if (isMap(node)) {
    node.flow = false;
    return;
  }
  document.set(key, document.createNode({}));
}

function addActionEntry(name: string): ManifestEdit {
  return (document, manifest) => {
    if (document.hasIn(["actions", name])) {
      return problem(manifest, `${manifest} already has an action ${name}.`, "Choose another name.");
    }
    blockMapAt(document, "actions");
    const action = document.createNode({
      input: `schemas/${name}-input.json`,
      output: `schemas/${name}-output.json`,
      effects: ["read"],
      run: [{ script: `scripts/${name}.ts` }],
    });
    const effects = isMap(action) ? action.get("effects", true) : undefined;
    if (isSeq(effects)) {
      effects.flow = true;
    }
    document.setIn(["actions", name], action);
    return undefined;
  };
}

function actionFiles(folder: string, name: string): readonly TemplateUse[] {
  const schema = (direction: string): TemplateUse => ({
    template: "action/schema.json",
    path: join(folder, "schemas", `${name}-${direction}.json`),
    slots: { name, direction, title: `${name}-${direction}` },
  });
  return [
    schema("input"),
    schema("output"),
    { template: "action/script.ts.template", path: join(folder, "scripts", `${name}.ts`), slots: {} },
    { template: "action/example.json", path: join(folder, "tests", `${name}.example.json`), slots: {} },
  ];
}

async function inMode(
  workspace: Workspace,
  part: ModePart,
  plan: (folder: string) => Promise<Planned>,
): Promise<Generated> {
  const target = await modeTarget(workspace, part.mode);
  const refusals = nameProblems(part.kind, part.name, target.ok ? target.value : part.mode);
  if (!target.ok || refusals.length > 0) {
    return refused([...(target.ok ? [] : target.problems), ...refusals]);
  }
  return writePlanned(workspace, await plan(target.value));
}

export async function newAction(workspace: Workspace, mode: string, name: string): Promise<Generated> {
  return inMode(workspace, { mode, kind: "action", name }, async (folder) => {
    const planned = await renderAll(workspace, actionFiles(folder, name));
    return withManifest(planned, await editManifest(workspace, folder, addActionEntry(name)));
  });
}

export async function newSkill(workspace: Workspace, mode: string, name: string): Promise<Generated> {
  const skillFile = (folder: string): TemplateUse => ({
    template: "skill/SKILL.md",
    path: join(folder, "skills", name, "SKILL.md"),
    slots: { name },
  });
  return inMode(workspace, { mode, kind: "skill", name }, (folder) => renderAll(workspace, [skillFile(folder)]));
}

function addWorkflowEntry(path: string): ManifestEdit {
  return (document, manifest) => {
    const workflows = document.get("workflows", true);
    if (workflows === undefined) {
      document.set("workflows", document.createNode([path]));
      return undefined;
    }
    if (!isSeq(workflows)) {
      return problem(
        manifest,
        `${manifest} has a workflows entry that is not a list.`,
        "Make workflows: a list of files.",
      );
    }
    if (workflows.items.some((item) => isScalar(item) && item.value === path)) {
      return problem(manifest, `${manifest} already lists the workflow ${path}.`, "Choose another name.");
    }
    workflows.add(document.createNode(path));
    return undefined;
  };
}

export async function newWorkflow(workspace: Workspace, mode: string, name: string): Promise<Generated> {
  const path = `workflows/${name}.yaml`;
  return inMode(workspace, { mode, kind: "workflow", name }, async (folder) => {
    const workflowFile = { template: "workflow/workflow.yaml", path: join(folder, path), slots: { name } };
    const planned = await renderAll(workspace, [workflowFile]);
    return withManifest(planned, await editManifest(workspace, folder, addWorkflowEntry(path)));
  });
}

export async function newInterface(workspace: Workspace, name: string): Promise<Generated> {
  const path = join(interfacesFolder, `${name}.yaml`);
  const refusals = nameProblems("interface", name, path);
  if (refusals.length > 0) {
    return refused(refusals);
  }
  const planned = await renderAll(workspace, [{ template: "interface/interface.yaml", path, slots: { name } }]);
  return writePlanned(workspace, planned);
}
