import { succeeded, withKernel, type CommandResult, type Invocation } from "../command-context.ts";
import type { Command } from "../command-line.ts";
import { bindingUses } from "../manifests/manifests.ts";
import { bindingLines, listSettings, settingLines } from "../settings-listing.ts";

function runConfig(invocation: Invocation): Promise<CommandResult> {
  return withKernel(invocation, async (kernel) => {
    const settings = await listSettings(kernel);
    const json = settings.map((setting) => ({
      name: setting.name,
      type: setting.type,
      description: setting.description,
      ...(setting.current === undefined ? {} : { current: setting.current }),
    }));
    const bindings = bindingUses(kernel.system);
    return succeeded(
      { settings: json, bindings: bindings.map((use) => ({ ...use, requirers: [...use.requirers] })) },
      `${settingLines(settings)}\n${bindingLines(bindings)}`,
    );
  });
}

export const configCommand: Command = {
  name: "config",
  summary: "Print every setting the project config may hold, with its current value, and which mode serves whom.",
  usage: "config",
  options: [],
  positionals: { least: 0, most: 0 },
  handler: runConfig,
};
