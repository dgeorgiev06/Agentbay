import { errorLine } from "./answers.ts";

export type LastResortEffects = {
  readonly write: (text: string) => void;
  readonly exit: (code: number) => void;
};

const lastResortWording = "an error escaped every handler and agentbay stopped";

const internalErrorCode = 70;

export function lastResortHandler(program: string, effects: LastResortEffects): (reason: unknown) => void {
  return (reason) => {
    effects.write(`${program}: ${lastResortWording}: ${errorLine(reason)}\n`);
    effects.exit(internalErrorCode);
  };
}
