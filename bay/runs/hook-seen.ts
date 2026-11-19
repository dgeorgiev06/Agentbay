import { basename, normalize } from "node:path/posix";
import type { Config } from "../generated/config.ts";
import { skillStepsRunOf, type SkillStepsRun } from "../manifests/manifests.ts";
import { failedWith, succeededWith, unplacedProblem, type Outcome } from "../outcome.ts";

export type HandedInStep = {
  readonly token: string;
  readonly mode: string;
  readonly skill: string;
};

export type HookWatch = {
  readonly config: () => Promise<Outcome<Config>>;
  readonly saw: (adapter: string, handedIn: HandedInStep) => Promise<boolean>;
};

export type HookNote = {
  readonly stepKey: string;
  readonly hookSaw: boolean;
  readonly skillSteps: SkillStepsRun;
};

export const hookNoteKind = "skill.hook";

type Answer = {
  readonly runId: string;
  readonly stepKey: string;
  readonly token: string;
  readonly mode: string;
  readonly skill: string;
};

function notTaken(why: string, answer: Answer): Outcome<never> {
  return failedWith([
    unplacedProblem(
      `The kernel did not take this output. ${why} ` +
        `Run ${answer.runId} still waits for step ${answer.stepKey}. Two ways on: hand the task to that agent in a ` +
        "Claude Code session where the agentbay hook is active, or the owner sets skillSteps.run to " +
        "without-the-hook in agentbay.config.yaml.",
    ),
  ]);
}

export async function hookNoteFor(watch: HookWatch, answer: Answer): Promise<Outcome<HookNote>> {
  const config = await watch.config();
  if (!config.ok) {
    const why =
      "agentbay.config.yaml cannot be read or is not valid, so the kernel cannot tell whether skill steps run with " +
      "the hook; bay check says what is wrong.";
    return notTaken(why, answer);
  }
  const skillSteps = skillStepsRunOf(config.value);
  const skill = basename(normalize(answer.skill));
  const hookSaw = await watch.saw(config.value.adapter, { token: answer.token, mode: answer.mode, skill });
  if (skillSteps === "with-the-hook" && !hookSaw) {
    const why =
      "This project runs skill steps with the hook, and the agentbay hook did not see the agent of skill " +
      `${skill} of mode ${answer.mode} hand it in with this task's token.`;
    return notTaken(why, answer);
  }
  return succeededWith({ stepKey: answer.stepKey, hookSaw, skillSteps });
}
