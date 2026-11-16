import type { ModeGrants } from "../contracts.ts";
import { grantsOf, type GrantProblem } from "../policy.ts";
import { problemAt } from "./spec.ts";
import { failedWith, succeededWith, type Outcome, type Problem } from "../outcome.ts";
import type { ModeSource, Context } from "./loaded.ts";

function placedGrantProblem(mode: ModeSource, problem: GrantProblem): Problem {
  return problemAt(mode, problem.at, { message: problem.message, fix: problem.fix });
}

export function grantsOfActiveModes(context: Context): Outcome<ReadonlyMap<string, ModeGrants>> {
  const granted = new Map<string, ModeGrants>();
  const problems: Problem[] = [];
  for (const mode of [...context.active].flatMap((name) => context.modes.get(name) ?? [])) {
    const otherModes = [...context.modes.values()]
      .filter((other) => other !== mode)
      .map((other) => ({ name: other.value.name, folder: other.folder, manifest: other.value }));
    const ruling = grantsOf({
      manifest: mode.value,
      home: mode.home,
      folder: mode.folder,
      layout: context.layout,
      otherModes,
    });
    if (ruling.ok) {
      granted.set(mode.value.name, ruling.value);
    } else {
      problems.push(...ruling.problems.map((problem) => placedGrantProblem(mode, problem)));
    }
  }
  return problems.length > 0 ? failedWith(problems) : succeededWith(granted);
}
