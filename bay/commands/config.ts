import { succeeded, withKernel, type CommandResult, type Invocation } from "../command-context.ts";
import { bindingUses } from "../manifests/manifests.ts";
import { bindingLines, listSettings, settingLines } from "../settings-listing.ts";

export function runConfig(invocation: Invocation): Promise<CommandResult> {
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
