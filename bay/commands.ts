import type { Command } from "./command-line.ts";
import { approveCommand } from "./commands/approve.ts";
import { buildCommand } from "./commands/build.ts";
import { callCommand } from "./commands/call.ts";
import { checkCommand } from "./commands/check.ts";
import { configCommand } from "./commands/config.ts";
import { newCommand } from "./commands/new.ts";
import { authCommand, importCommand } from "./commands/not-built.ts";
import { resumeCommand } from "./commands/resume.ts";
import { runsCommand } from "./commands/runs.ts";
import { secretCommand } from "./commands/secret.ts";
import { submitCommand } from "./commands/submit.ts";

export const commands: readonly Command[] = [
  checkCommand,
  newCommand,
  callCommand,
  submitCommand,
  runsCommand,
  approveCommand,
  resumeCommand,
  buildCommand,
  secretCommand,
  authCommand,
  configCommand,
  importCommand,
];
