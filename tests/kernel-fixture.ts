import assert from "node:assert/strict";
import { layoutOf } from "../bay/layout.ts";
import { loadKernel, nodeKernelPorts, type Kernel, type KernelLimits, type KernelPorts } from "../bay/kernel.ts";
import { kit, makeProject, type Project, type ProjectOptions } from "./project-fixture.ts";

export type KernelSetup = {
  readonly limits?: Partial<KernelLimits>;
  readonly environment?: Readonly<Record<string, string>>;
  readonly ports?: Partial<KernelPorts>;
};

export const testEnvironment = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

export async function openKernel(project: Project, setup: KernelSetup = {}): Promise<Kernel> {
  const environment = { ...testEnvironment, ...setup.environment };
  const loaded = await loadKernel({
    layout: layoutOf({ kit, project: project.root }),
    ports: { ...nodeKernelPorts(environment), ...setup.ports },
    environment,
    platform: "linux",
    ...(setup.limits === undefined ? {} : { limits: setup.limits }),
  });
  assert.ok(loaded.ok, loaded.ok ? "" : JSON.stringify(loaded.problems, null, 2));
  return loaded.value;
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
