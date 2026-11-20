import type { Config } from "../generated/config.ts";
import { isProjectTheKit } from "../layout.ts";
import { problemAt, type Loaded } from "../value-check.ts";
import type { Problem } from "../outcome.ts";
import type { ModeFolder } from "./folders.ts";
import type { LoadedModes, Context } from "./loaded.ts";
import { candidatesOf, interfaceName, requirersOf } from "./interfaces.ts";
import { bindingsFrom } from "./bindings.ts";

type Activation = {
  readonly active: ReadonlySet<string>;
  readonly config: Loaded<Config> | undefined;
  readonly problems: readonly Problem[];
  readonly notices: readonly Problem[];
};

type Seeded = Pick<Activation, "active" | "problems">;

type Brought = {
  readonly reference: string;
  readonly mode: string;
};

const forge = "forge";

const broughtByForge: readonly Brought[] = [
  { reference: "proof@1", mode: "proof" },
  { reference: "worktrees@1", mode: "git-worktrees" },
  { reference: "requirements@1", mode: "requirements" },
];

const toolchain = "toolchain@1";

export function homesOf(modes: LoadedModes): ReadonlyMap<string, ModeFolder> {
  const loaded = modes.values.map((mode) => ({ name: mode.value.name, home: mode.home, folder: mode.folder }));
  const homes = new Map<string, ModeFolder>();
  for (const mode of [...loaded, ...modes.unloaded]) {
    if (!homes.has(mode.name)) {
      homes.set(mode.name, { home: mode.home, folder: mode.folder });
    }
  }
  return homes;
}

function listedModeProblem(context: Context, name: string, index: number): Problem | undefined {
  const config = context.config;
  if (config === undefined || context.modes.has(name) || context.unloadedModes.has(name)) {
    return undefined;
  }
  return problemAt(config, ["modes", index], {
    message: `modes lists ${name}, which is not a mode of the kit or of the project.`,
    fix: `Correct the name, or remove ${name} from modes.`,
  });
}

function seedModes(context: Context, homes: ReadonlyMap<string, ModeFolder>): Seeded {
  const listed = context.config?.value.modes ?? [];
  const problems = listed.flatMap((name, index) => listedModeProblem(context, name, index) ?? []);
  if (isProjectTheKit(context.layout)) {
    return { active: new Set(homes.keys()), problems };
  }
  const own = [...homes].filter(([, mode]) => mode.home === "project").map(([name]) => name);
  const known = listed.filter((name) => homes.has(name));
  return { active: new Set([...own, ...known]), problems };
}

function reached(context: Context, homes: ReadonlyMap<string, ModeFolder>, seeds: Iterable<string>): Set<string> {
  const active = new Set(seeds);
  const queue = [...active];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    for (const binding of bindingsFrom(context, name)) {
      const bound = binding.bound.mode;
      if (!active.has(bound) && homes.has(bound)) {
        active.add(bound);
        queue.push(bound);
      }
    }
  }
  return active;
}

function isBound(config: Loaded<Config>, reference: string): boolean {
  return Object.hasOwn(config.value.bindings, interfaceName(reference));
}

function withBrought(config: Loaded<Config>, brought: readonly Brought[]): Loaded<Config> {
  const added = Object.fromEntries(brought.map(({ reference, mode }) => [interfaceName(reference), mode]));
  return { ...config, value: { ...config.value, bindings: { ...config.value.bindings, ...added } } };
}

function broughtNotice(config: Loaded<Config>, { reference, mode }: Brought): Problem {
  const name = interfaceName(reference);
  return problemAt(config, ["bindings"], {
    message: `Forge brings the mode ${mode}, bound to ${reference}, since the config binds no mode to ${name}.`,
    fix: `To use another mode that implements ${reference}, bind ${name} to it under bindings; ${mode} is then not brought.`,
  });
}

function noToolchainProblems(context: Context, active: ReadonlySet<string>): readonly Problem[] {
  const config = context.config;
  const needed = requirersOf(context, interfaceName(toolchain)).some((name) => active.has(name));
  if (config === undefined || !needed || isBound(config, toolchain)) {
    return [];
  }
  const problem = problemAt(config, ["bindings"], {
    message:
      `Forge is active and no mode is bound to ${toolchain}: forge brings proof, git-worktrees and requirements, ` +
      "but not a toolchain, since a project names its own.",
    fix:
      `Add ${interfaceName(toolchain)}: <mode> under bindings, naming the mode for the project's language; ` +
      `modes that implement ${toolchain}: ${candidatesOf(context, toolchain)}.`,
  });
  return [problem];
}

export function activation(context: Context, homes: ReadonlyMap<string, ModeFolder>): Activation {
  const seeded = seedModes(context, homes);
  const active = reached(context, homes, seeded.active);
  const config = context.config;
  if (config === undefined || !active.has(forge)) {
    return { active, config, problems: seeded.problems, notices: [] };
  }
  const brought = broughtByForge.filter(({ reference, mode }) => homes.has(mode) && !isBound(config, reference));
  const withForge = { ...context, config: withBrought(config, brought) };
  const withBroughtModes = reached(withForge, homes, [...active, ...brought.map(({ mode }) => mode)]);
  return {
    active: withBroughtModes,
    config: withForge.config,
    problems: [...seeded.problems, ...noToolchainProblems(withForge, withBroughtModes)],
    notices: brought.map((each) => broughtNotice(config, each)),
  };
}
