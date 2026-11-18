import { isProjectTheKit } from "../layout.ts";
import { problemAt } from "../value-check.ts";
import type { Problem } from "../outcome.ts";
import type { ModeFolder } from "./folders.ts";
import type { LoadedModes, Context } from "./loaded.ts";
import { interfaceName } from "./interfaces.ts";
import { type RequiredBinding, bindingsFrom } from "./bindings.ts";

type Activation = {
  readonly active: ReadonlySet<string>;
  readonly problems: readonly Problem[];
};

const forge = "forge";

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
  if (config === undefined) {
    return undefined;
  }
  if (name === forge && !isProjectTheKit(context.layout)) {
    return problemAt(config, ["modes", index], {
      message: "modes lists forge, which can be active only when the project is the kit itself.",
      fix: "Remove forge from modes; forge changes the kit, so it runs only in the kit's own folder.",
    });
  }
  if (context.modes.has(name) || context.unloadedModes.has(name)) {
    return undefined;
  }
  return problemAt(config, ["modes", index], {
    message: `modes lists ${name}, which is not a mode of the kit or of the project.`,
    fix: `Correct the name, or remove ${name} from modes.`,
  });
}

function seedModes(context: Context, homes: ReadonlyMap<string, ModeFolder>): Activation {
  const listed = context.config?.value.modes ?? [];
  const problems = listed.flatMap((name, index) => listedModeProblem(context, name, index) ?? []);
  if (isProjectTheKit(context.layout)) {
    return { active: new Set(homes.keys()), problems };
  }
  const own = [...homes].filter(([, mode]) => mode.home === "project").map(([name]) => name);
  const known = listed.filter((name) => homes.has(name) && name !== forge);
  return { active: new Set([...own, ...known]), problems };
}

function boundForgeProblems(context: Context, binding: RequiredBinding): readonly Problem[] {
  const config = context.config;
  if (config === undefined) {
    return [];
  }
  const { reference, bound } = binding;
  const problem = problemAt(config, bound.path, {
    message: `bindings binds ${bound.label} to forge, which can be active only when the project is the kit itself.`,
    fix: `Bind ${interfaceName(reference)} to another mode that implements ${reference}.`,
  });
  return [problem];
}

export function activation(context: Context, homes: ReadonlyMap<string, ModeFolder>): Activation {
  const seeded = seedModes(context, homes);
  const active = new Set(seeded.active);
  const problems = [...seeded.problems];
  const queue = [...active];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    for (const binding of bindingsFrom(context, name)) {
      const bound = binding.bound.mode;
      if (active.has(bound) || !homes.has(bound)) {
        continue;
      }
      if (bound === forge && !isProjectTheKit(context.layout)) {
        problems.push(...boundForgeProblems(context, binding));
        continue;
      }
      active.add(bound);
      queue.push(bound);
    }
  }
  return { active, problems };
}
