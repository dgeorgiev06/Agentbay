import { counted } from "./item-words.ts";
import type { GrantedCommand, ListTrust, ModeList, TrustGiven } from "./contracts.ts";
import { listed } from "./answers.ts";
import { errors, isLoaded, warnings, type CheckContext, type Finding, type LoadedModeFolder } from "./check-context.ts";
import type { Outcome, Problem } from "./outcome.ts";
import { listedCommandsOf, listTrustOf } from "./policy.ts";
import { listChanges, scriptFileChanges, scriptFilesOf, shown, type CommandChange, type TrustRecord } from "./trust.ts";

type GrantedBy = { readonly by: "place" } | { readonly by: "trust"; readonly given: TrustGiven };

type Counts = {
  readonly noun: string;
  readonly counts: readonly (readonly [number, string])[];
};

type ChangedTrust = Extract<ListTrust, { readonly state: "changed" }>;

function dayOf(given: TrustGiven): string {
  return shown(given.at.slice(0, 10));
}

function decideCommand(mode: string): string {
  return `bay approve --trust ${mode}`;
}

function commandSubject(mode: LoadedModeFolder, granted: GrantedBy): string {
  switch (granted.by) {
    case "place":
      return `Mode ${mode.manifest.name}`;
    case "trust":
      return `Mode ${mode.manifest.name}, trusted on ${dayOf(granted.given)} by the ${shown(granted.given.by)},`;
  }
}

function commandFix(mode: LoadedModeFolder, granted: GrantedBy): string {
  switch (granted.by) {
    case "place":
      return (
        "Remove the command unless the mode cannot work without it. If it stays, review its words and its effects: " +
        "the kernel believes the effects a mode lists and cannot check them."
      );
    case "trust":
      return (
        `Withdraw with ${decideCommand(mode.manifest.name)} --reject unless the mode cannot work without the ` +
        "command. The kernel believes the effects a mode lists and cannot check them."
      );
  }
}

function commandWarning(mode: LoadedModeFolder, command: GrantedCommand, granted: GrantedBy): Problem {
  const { name, words, effects } = command;
  return mode.at(["resources", "commands", name], {
    message:
      `${commandSubject(mode, granted)} lists the command ${shown(name)}, which runs ${shown(words.join(" "))} and ` +
      `which the mode says has the effects: ${listed(effects, "none")}; a listed command can run code the agent wrote.`,
    fix: commandFix(mode, granted),
  });
}

function commandWarnings(mode: LoadedModeFolder, granted: GrantedBy): readonly Problem[] {
  return listedCommandsOf(mode.manifest).map((command) => commandWarning(mode, command, granted));
}

function listSize(list: ModeList): string {
  const parts = [
    list.commands.length === 0 ? [] : [counted(list.commands.length, "command")],
    list.throwaway.length === 0 ? [] : [counted(list.throwaway.length, "throwaway folder")],
  ];
  return parts.flat().join(" and ");
}

function neverTrustedWarning(mode: LoadedModeFolder, list: ModeList): Problem {
  const name = mode.manifest.name;
  return mode.at(["resources"], {
    message:
      `Mode ${name} lists ${listSize(list)}, and the owner does not trust the list of mode ${name}, ` +
      "so none of it is granted.",
    fix: `The owner reads the list and decides: ${decideCommand(name)}`,
  });
}

function countsText(counts: Counts): readonly string[] {
  const nonZero = counts.counts.filter(([count]) => count > 0);
  return nonZero.map(([count, verb], index) =>
    index === 0 ? `${counted(count, counts.noun)} ${verb}` : `${String(count)} ${verb}`,
  );
}

function changesText(trust: ChangedTrust): string {
  const changes = listChanges(trust.given.list, trust.list);
  const commandsOf = (change: CommandChange["change"]): number =>
    changes.commands.filter((command) => command.change === change).length;
  const commands = countsText({
    noun: "command",
    counts: [
      [commandsOf("added"), "added"],
      [commandsOf("removed"), "removed"],
      [commandsOf("changed"), "changed"],
    ],
  });
  const folders = countsText({
    noun: "throwaway folder",
    counts: [
      [changes.folders.added.length, "added"],
      [changes.folders.removed.length, "removed"],
    ],
  });
  const groups = [commands, folders].filter((group) => group.length > 0).map((group) => group.join(", "));
  return groups.length === 0 ? "" : ` (${groups.join("; ")})`;
}

function changedWarning(mode: LoadedModeFolder, trust: ChangedTrust): Problem {
  const name = mode.manifest.name;
  return mode.at(["resources"], {
    message:
      `The list of mode ${name} is not the list the owner trusted on ${dayOf(trust.given)}${changesText(trust)}, ` +
      "so none of it is granted.",
    fix: `The owner reads what changed and decides: ${decideCommand(name)}`,
  });
}

async function scriptsWarnings(
  context: CheckContext,
  mode: LoadedModeFolder,
  given: TrustGiven,
): Promise<readonly Problem[]> {
  const now = await scriptFilesOf(context.files, mode.folder, mode.files);
  const files = scriptFileChanges(given.scripts, now);
  if (files.length === 0) {
    return [];
  }
  const name = mode.manifest.name;
  const named = files.map(({ path, change }) => `${shown(path)} ${change}`).join(", ");
  return [
    mode.at([], {
      message:
        `${counted(files.length, "script file")} of mode ${name} changed since the owner trusted its list on ` +
        `${dayOf(given)}: ${named}. The list did not change, so the trust stands; the scripts choose the arguments ` +
        "of its commands.",
      fix: `Read the changes. To record that you have, decide again: ${decideCommand(name)}`,
    }),
  ];
}

async function modeTrustProblems(
  context: CheckContext,
  mode: LoadedModeFolder,
  record: Outcome<TrustRecord>,
): Promise<readonly Problem[]> {
  const { manifest, home, folder } = mode;
  const listTrust = listTrustOf({ manifest, home, folder, layout: context.layout, record });
  switch (listTrust.state) {
    case "not needed":
      return commandWarnings(mode, { by: "place" });
    case "trusted": {
      const granted = { by: "trust", given: listTrust.given } as const;
      return [...commandWarnings(mode, granted), ...(await scriptsWarnings(context, mode, listTrust.given))];
    }
    case "never trusted":
      return [neverTrustedWarning(mode, listTrust.list)];
    case "changed":
      return [changedWarning(mode, listTrust)];
    case "unreadable record":
      return [];
  }
}

export async function checkTrust(context: CheckContext, record: Outcome<TrustRecord>): Promise<readonly Finding[]> {
  const modes = context.modes.filter(isLoaded);
  const problems = await Promise.all(modes.map((mode) => modeTrustProblems(context, mode, record)));
  return [...(record.ok ? [] : errors(record.problems)), ...warnings(problems.flat())];
}
