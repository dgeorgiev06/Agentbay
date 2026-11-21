import assert from "node:assert/strict";
import type { Json } from "../bay/contracts.ts";
import { layoutOf } from "../bay/layout.ts";
import { loadKernel, type Kernel, type KernelLimits } from "../bay/kernel.ts";
import { nodeKernelPorts, type KernelPorts } from "../bay/kernel-ports.ts";
import { kit, makeProject, type Project, type ProjectOptions } from "./project-fixture.ts";

export type KernelSetup = {
  readonly kit?: string;
  readonly limits?: Partial<KernelLimits>;
  readonly environment?: Readonly<Record<string, string>>;
  readonly ports?: Partial<KernelPorts>;
};

export const testEnvironment = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

export async function openKernel(project: Project, setup: KernelSetup = {}): Promise<Kernel> {
  const environment = { ...testEnvironment, ...setup.environment };
  const loaded = await loadKernel({
    layout: layoutOf({ kit: setup.kit ?? kit, project: project.root }),
    ports: { ...nodeKernelPorts(environment), ...setup.ports },
    environment,
    platform: "linux",
    ...(setup.limits === undefined ? {} : { limits: setup.limits }),
  });
  assert.ok(loaded.ok, loaded.ok ? "" : JSON.stringify(loaded.problems, null, 2));
  return loaded.value;
}

export type StartedTask = {
  readonly runId: string;
  readonly stepKey: string;
  readonly token: string;
};

export async function startedTask(kernel: Kernel, action: string, input: Json): Promise<StartedTask> {
  const started = await kernel.runs.start({ action }, input);
  assert.ok(started.ok && started.value.state.status === "waiting", JSON.stringify(started));
  const waiting = started.value.state.waiting;
  assert.ok(waiting.reason === "skill" && waiting.task.token !== undefined, JSON.stringify(waiting));
  return { runId: started.value.id, stepKey: waiting.stepKey, token: waiting.task.token };
}

export type Opened = {
  readonly project: Project;
  readonly kernel: Kernel;
  readonly close: () => Promise<void>;
};

export async function openProject(options: ProjectOptions = {}, setup: KernelSetup = {}): Promise<Opened> {
  const project = await makeProject(options);
  const kernel = await openKernel(project, setup);
  return {
    project,
    kernel,
    close: async () => {
      kernel.close();
      await project.remove();
    },
  };
}
