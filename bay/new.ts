import { dirname, join, relative } from "node:path/posix";
import { isMap, isScalar, isSeq, parseDocument, type Document } from "yaml";
import { isProjectTheKit, pathIn, type Layout } from "./layout.ts";
import type { FileSystem } from "./ports.ts";
import { placeToWrite, type NewPart } from "./manifests/manifests.ts";
import { sdkSpecifier } from "./broker/script-protocol.ts";
import { failedWith, type Outcome, type Problem } from "./outcome.ts";

export type ModeTier = Extract<NewPart, { readonly tier: string }>["tier"];

export type Workspace = {
  readonly files: FileSystem;
  readonly layout: Layout;
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

type ModePart = Extract<NewPart, { readonly inMode: string }>;

const templatesFolder = "bay/templates";

const sdkFile = "bay/sdk.ts";

const leftoverSlotPattern = /\{\{[a-z]+\}\}/;

function problem(file: string, message: string, fix: string): Problem {
  return { file, path: "", message, fix };
}

function fill(text: string, slots: Slots): string {
  return Object.entries(slots).reduce((filled, [slot, value]) => filled.replaceAll(`{{${slot}}}`, value), text);
}

async function render(workspace: Workspace, use: TemplateUse): Promise<Outcome<PlannedFile>> {
  const templateFile = join(templatesFolder, use.template);
  const text = await workspace.files.readText(pathIn(workspace.layout, "kit", templateFile));
  if (text === undefined) {
    return failedWith([problem(templateFile, `The template ${templateFile} is missing.`, "Restore it from the kit.")]);
  }
  const filled = fill(text, use.slots);
  const leftover = leftoverSlotPattern.exec(filled)?.[0];
  if (leftover !== undefined) {
    return failedWith([
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
  return problems.length > 0 ? failedWith(problems) : { ok: true, value: planned };
}

async function existingProblems(workspace: Workspace, planned: readonly PlannedFile[]): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const file of planned.filter((entry) => !entry.edit)) {
    if (await workspace.files.exists(pathIn(workspace.layout, "project", file.path))) {
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
    return failedWith(existing);
  }
  for (const file of planned.value) {
    await workspace.files.writeAtomic(pathIn(workspace.layout, "project", file.path), file.text);
  }
  return { ok: true, value: planned.value.map((file) => file.path) };
}

export async function newMode(workspace: Workspace, name: string, tier: ModeTier): Promise<Generated> {
  const folder = await placeToWrite(workspace.files, workspace.layout, { mode: name, tier });
  if (!folder.ok) {
    return folder;
  }
  const planned = await renderAll(workspace, [
    { template: "mode/mode.yaml", path: join(folder.value, "mode.yaml"), slots: { name } },
    { template: "mode/README.md", path: join(folder.value, "README.md"), slots: { name } },
  ]);
  return writePlanned(workspace, planned);
}

async function editManifest(workspace: Workspace, folder: string, edit: ManifestEdit): Promise<Outcome<PlannedFile>> {
  const manifest = join(folder, "mode.yaml");
  const text = (await workspace.files.readText(pathIn(workspace.layout, "project", manifest))) ?? "";
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    return failedWith([
      problem(manifest, `${manifest} cannot be read as YAML.`, "Correct it, then run bay new again."),
    ]);
  }
  const refusal = edit(document, manifest);
  if (refusal !== undefined) {
    return failedWith([refusal]);
  }
  return { ok: true, value: { path: manifest, text: document.toString(), edit: true } };
}

function withManifest(planned: Planned, manifest: Outcome<PlannedFile>): Planned {
  if (!manifest.ok) {
    return planned.ok ? manifest : failedWith([...planned.problems, ...manifest.problems]);
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
      description: `Replace this line with one sentence on when to use ${name}.`,
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

function sdkImportOf(layout: Layout, script: string): string {
  if (!isProjectTheKit(layout)) {
    return sdkSpecifier;
  }
  return relative(dirname(pathIn(layout, "project", script)), pathIn(layout, "kit", sdkFile));
}

function actionFiles(layout: Layout, folder: string, name: string): readonly TemplateUse[] {
  const script = join(folder, "scripts", `${name}.ts`);
  const schema = (direction: string): TemplateUse => ({
    template: "action/schema.json",
    path: join(folder, "schemas", `${name}-${direction}.json`),
    slots: { name, direction, title: `${name}-${direction}` },
  });
  return [
    schema("input"),
    schema("output"),
    { template: "action/script.ts.template", path: script, slots: { sdk: sdkImportOf(layout, script) } },
    { template: "action/example.json", path: join(folder, "tests", `${name}.example.json`), slots: {} },
  ];
}

async function inMode(
  workspace: Workspace,
  part: ModePart,
  plan: (folder: string) => Promise<Planned>,
): Promise<Generated> {
  const target = await placeToWrite(workspace.files, workspace.layout, part);
  return target.ok ? writePlanned(workspace, await plan(target.value)) : target;
}

export async function newAction(workspace: Workspace, mode: string, name: string): Promise<Generated> {
  return inMode(workspace, { inMode: mode, kind: "action", name }, async (folder) => {
    const planned = await renderAll(workspace, actionFiles(workspace.layout, folder, name));
    return withManifest(planned, await editManifest(workspace, folder, addActionEntry(name)));
  });
}

export async function newSkill(workspace: Workspace, mode: string, name: string): Promise<Generated> {
  const skillFile = (folder: string): TemplateUse => ({
    template: "skill/SKILL.md",
    path: join(folder, "skills", name, "SKILL.md"),
    slots: { name },
  });
  return inMode(workspace, { inMode: mode, kind: "skill", name }, (folder) =>
    renderAll(workspace, [skillFile(folder)]),
  );
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
  return inMode(workspace, { inMode: mode, kind: "workflow", name }, async (folder) => {
    const workflowFile = { template: "workflow/workflow.yaml", path: join(folder, path), slots: { name } };
    const planned = await renderAll(workspace, [workflowFile]);
    return withManifest(planned, await editManifest(workspace, folder, addWorkflowEntry(path)));
  });
}

export async function newInterface(workspace: Workspace, name: string): Promise<Generated> {
  const path = await placeToWrite(workspace.files, workspace.layout, { interface: name });
  if (!path.ok) {
    return path;
  }
  const template = { template: "interface/interface.yaml", path: path.value, slots: { name } };
  return writePlanned(workspace, await renderAll(workspace, [template]));
}
