import type { RefusalWording } from "../answers.ts";
import type { TrustGiven } from "../contracts.ts";
import type { Problem } from "../outcome.ts";
import type { Asking } from "./rule.ts";

type ListRefusal = Pick<RefusalWording, "declared" | "change">;

type NotInForce = { readonly inForce: false; readonly refusal: ListRefusal };

type ListInForce = { readonly inForce: true } | NotInForce;

const inForce: ListInForce = { inForce: true };

const nothingGranted = "so none of its commands or throwaway folders is granted";

function notInForce(refusal: ListRefusal): NotInForce {
  return { inForce: false, refusal };
}

function decidesWith(mode: string): string {
  return `bay approve --trust ${mode}`;
}

function dayOf(at: string): string {
  return at.slice(0, "yyyy-mm-dd".length);
}

function neverTrusted(mode: string): NotInForce {
  return notInForce({
    declared: `the owner does not trust the list of mode ${mode}, ${nothingGranted}`,
    change: `The owner reads the list and decides with: ${decidesWith(mode)}.`,
  });
}

function changedSinceTrusted(mode: string, trustedAt: string): NotInForce {
  return notInForce({
    declared: `the list of mode ${mode} is not the list the owner trusted on ${dayOf(trustedAt)}, ${nothingGranted}`,
    change: `The owner reads what changed and decides with: ${decidesWith(mode)}.`,
  });
}

function withinASentence(message: string): string {
  return `${message.charAt(0).toLowerCase()}${message.slice(1)}`.replace(/\.$/u, "");
}

const noProblemGiven: Problem = { file: "the trust record", path: "", message: "The trust record cannot be read." };

function unreadableRecord(mode: string, problems: readonly Problem[]): NotInForce {
  const first = problems[0] ?? noProblemGiven;
  return notInForce({
    declared: withinASentence(first.message),
    change: `The owner removes ${first.file}, then trusts each mode again, this one with: ${decidesWith(mode)}.`,
  });
}

function changedAfterLoad(refused: NotInForce): NotInForce {
  const { declared, change } = refused.refusal;
  return notInForce({
    declared: `${declared}; the trust record changed after this run loaded the mode's list`,
    change,
  });
}

async function stillTrusted(mode: string, loaded: TrustGiven, asking: Asking): Promise<ListInForce> {
  const record = await asking.trustRecordNow();
  if (!record.ok) {
    return changedAfterLoad(unreadableRecord(mode, record.problems));
  }
  const { modes } = record.value;
  const now = Object.hasOwn(modes, mode) ? modes[mode] : undefined;
  if (now === undefined) {
    return changedAfterLoad(neverTrusted(mode));
  }
  return now.hash === loaded.hash ? inForce : changedAfterLoad(changedSinceTrusted(mode, now.at));
}

export async function listInForce(asking: Asking): Promise<ListInForce> {
  const { mode, listTrust } = asking.grants;
  switch (listTrust.state) {
    case "not needed":
      return inForce;
    case "trusted":
      return stillTrusted(mode, listTrust.given, asking);
    case "never trusted":
      return neverTrusted(mode);
    case "changed":
      return changedSinceTrusted(mode, listTrust.given.at);
    case "unreadable record":
      return unreadableRecord(mode, listTrust.problems);
  }
}
