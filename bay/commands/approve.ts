import {
  problemsResult,
  refusedResult,
  succeeded,
  usageResult,
  withKernel,
  type CommandResult,
  type Invocation,
  type Terminal,
} from "../command-context.ts";
import type { Command } from "../command-line.ts";
import type { ListTrust, ModeList, ScriptFiles, TrustGiven } from "../contracts.ts";
import type { Kernel } from "../kernel.ts";
import type { ActiveMode } from "../manifests/manifests.ts";
import type { Problem } from "../outcome.ts";
import { listOf } from "../policy.ts";
import { runResult } from "../run-report.ts";
import { shownPath } from "../layout.ts";
import {
  listHashOf,
  readTrustRecord,
  recordWithTrust,
  recordWithoutTrust,
  scriptFileChanges,
  scriptFilesOf,
  shown,
  writeTrustRecord,
  type ScriptFileChange,
} from "../trust.ts";
import { hashOf } from "../json.ts";
import { differenceCard, listSize, scriptsCard, trustCard, trustedWhen, withdrawCard } from "../trust-card.ts";

type Channel = { readonly via: "terminal" } | { readonly via: "chat"; readonly quote: string };

type ApprovalRequest = {
  readonly invocation: Invocation;
  readonly kernel: Kernel;
  readonly channel: Channel;
  readonly decision: Decision;
};

type Decision = {
  readonly runId: string;
  readonly stepKey: string;
  readonly hash: string;
  readonly verdict: "approve" | "reject";
};

type TrustChannel =
  { readonly via: "terminal" } | { readonly via: "chat"; readonly quote: string; readonly hash: string };

type TrustAsk = {
  readonly mode: string;
  readonly verdict: "give" | "withdraw";
  readonly channel: TrustChannel;
};

type TrustRequest = {
  readonly invocation: Invocation;
  readonly kernel: Kernel;
  readonly ask: TrustAsk;
};

type Card = {
  readonly lines: readonly string[];
  readonly hash: string;
  readonly prompt: string;
};

type Answerable = Exclude<ListTrust, { readonly state: "not needed" | "unreadable record" }>;

type TrustSubject =
  | { readonly verdict: "give"; readonly list: ModeList; readonly modeFolder: string; readonly card: Card }
  | { readonly verdict: "withdraw"; readonly given: TrustGiven; readonly card: Card }
  | {
      readonly verdict: "record scripts";
      readonly given: TrustGiven;
      readonly scripts: ScriptFiles;
      readonly card: Card;
    };

type ModeRefusal =
  | { readonly reason: "no such mode"; readonly mode: string }
  | { readonly reason: "inactive mode"; readonly mode: string }
  | { readonly reason: "lists nothing"; readonly mode: string }
  | { readonly reason: "base mode"; readonly mode: string }
  | { readonly reason: "already trusted"; readonly given: TrustGiven }
  | { readonly reason: "nothing to withdraw"; readonly mode: string }
  | { readonly reason: "unreadable record"; readonly problems: readonly Problem[] };

type AnswerRefusal =
  | { readonly reason: "not a terminal"; readonly ask: TrustAsk; readonly card: Card }
  | { readonly reason: "not confirmed" }
  | { readonly reason: "chat is off"; readonly ask: TrustAsk; readonly allowed: readonly string[] }
  | { readonly reason: "short hash"; readonly ask: TrustAsk; readonly hash: string }
  | { readonly reason: "another list"; readonly ask: TrustAsk; readonly hash: string }
  | { readonly reason: "quote lacks the mode"; readonly ask: TrustAsk; readonly quote: string };

type TrustRefusal = ModeRefusal | AnswerRefusal;

const answerReasons: Readonly<Record<AnswerRefusal["reason"], true>> = {
  "not a terminal": true,
  "not confirmed": true,
  "chat is off": true,
  "short hash": true,
  "another list": true,
  "quote lacks the mode": true,
};

const usage =
  'approve <run> <stepKey> --hash <hash> [--reject] [--via terminal | --via chat --quote "<the owner\'s words>"]; ' +
  'approve --trust <mode> [--reject] [--via chat --hash <hash> --quote "<the owner\'s words>"]';

const notConfirmed = "Not confirmed; nothing changed.";

const prompts = {
  first: "Type yes to trust it: ",
  changed: "Type yes to trust the new list: ",
  withdraw: "Type yes to withdraw: ",
  scripts: "Type yes to record that you read them: ",
};

function channelOf(invocation: Invocation): Channel | string {
  const via = invocation.values.get("via") ?? "terminal";
  const quote = invocation.values.get("quote")?.trim();
  switch (via) {
    case "terminal":
      return quote === undefined ? { via } : "--quote goes with --via chat; a terminal approval needs no quote.";
    case "chat":
      return quote === undefined || quote === ""
        ? '--via chat needs --quote "<the owner\'s exact words>".'
        : { via, quote };
    default:
      return `--via is terminal or chat, not ${via}.`;
  }
}

function allowedChannels(kernel: Kernel): readonly string[] {
  return kernel.system.config.approvals?.from ?? ["terminal"];
}

function byOf(channel: Channel): string {
  return channel.via === "terminal"
    ? "owner at the terminal"
    : `owner via chat, quoted: ${JSON.stringify(channel.quote)}`;
}

async function typedYes(terminal: Terminal, question: string): Promise<boolean> {
  const answer = await terminal.ask(question);
  return answer.trim().toLowerCase() === "yes";
}

async function shownText(kernel: Kernel, decision: Decision): Promise<string> {
  const shown = await kernel.runs.show(decision.runId);
  const state = shown.ok ? shown.value.state : undefined;
  const waiting = state?.status === "waiting" ? state.waiting : undefined;
  if (waiting?.reason !== "approval" || waiting.stepKey !== decision.stepKey) {
    return `step ${decision.stepKey} of run ${decision.runId}`;
  }
  return `${waiting.question}\n${JSON.stringify(waiting.content, null, 2)}\n(hash ${waiting.hash})`;
}

async function terminalRefusal(
  invocation: Invocation,
  kernel: Kernel,
  decision: Decision,
): Promise<string | undefined> {
  const terminal = invocation.context.terminal;
  if (!terminal.isInteractive()) {
    return (
      "bay approve needs an interactive terminal (stdin is not a TTY). Approvals are for the owner, not for agents: " +
      "run it yourself in a terminal, or, if the project config lists chat under approvals.from, use --via chat --quote."
    );
  }
  const verb = decision.verdict === "approve" ? "Approve" : "Reject";
  const confirmed = await typedYes(terminal, `${verb} ${await shownText(kernel, decision)}\nType yes to confirm: `);
  return confirmed ? undefined : notConfirmed;
}

async function decide(request: ApprovalRequest): Promise<CommandResult> {
  const { invocation, kernel, channel, decision } = request;
  const allowed = allowedChannels(kernel);
  if (!allowed.includes(channel.via)) {
    return refusedResult(
      `Approvals from ${channel.via} are off: approvals.from in agentbay.config.yaml lists ${allowed.join(", ")}.`,
      `Approve from ${allowed.join(" or ")}; only the owner changes approvals.from.`,
    );
  }
  const refusal = channel.via === "terminal" ? await terminalRefusal(invocation, kernel, decision) : undefined;
  if (refusal !== undefined) {
    return refusedResult(refusal);
  }
  const { runId, stepKey, hash, verdict } = decision;
  return runResult(kernel.layout, await kernel.runs.approve(runId, { stepKey, hash, verdict, by: byOf(channel) }));
}

function runApproval(invocation: Invocation): Promise<CommandResult> {
  const { positionals } = invocation;
  const [runId = "", stepKey = ""] = positionals;
  const hash = invocation.values.get("hash");
  const channel = channelOf(invocation);
  if (positionals.length !== 2) {
    return Promise.resolve(
      usageResult(
        `bay approve takes a run and a step key, or --trust <mode>, but ${String(positionals.length)} arguments were given.`,
        usage,
      ),
    );
  }
  if (hash === undefined) {
    return Promise.resolve(usageResult("approve needs --hash <the hash of what the approval shows>.", usage));
  }
  if (typeof channel === "string") {
    return Promise.resolve(usageResult(channel, usage));
  }
  const decision: Decision = { runId, stepKey, hash, verdict: invocation.flags.has("reject") ? "reject" : "approve" };
  return withKernel(invocation, (kernel) => decide({ invocation, kernel, channel, decision }));
}

function trustChannelOf(invocation: Invocation): TrustChannel | string {
  const channel = channelOf(invocation);
  const hash = invocation.values.get("hash");
  if (typeof channel === "string") {
    return channel;
  }
  if (channel.via === "terminal") {
    return hash === undefined
      ? channel
      : "--hash goes with --via chat; at a terminal the kernel records the hash of the card it shows.";
  }
  return hash === undefined ? "--via chat needs --hash <the full hash of the card>." : { ...channel, hash };
}

function rejectWords(ask: TrustAsk): string {
  return ask.verdict === "withdraw" ? " --reject" : "";
}

function notTerminalSentence(ask: TrustAsk, card: Card): string {
  const what = ask.verdict === "give" ? "Trust is the owner's to give" : "Withdrawing trust is the owner's to do";
  return (
    `Nothing changed. ${what}: at a terminal, or, if agentbay.config.yaml lists chat under approvals.from, ` +
    `with${rejectWords(ask)} --hash ${card.hash} --via chat --quote "<the owner's exact words>".`
  );
}

function withCard(card: Card, sentence: string): CommandResult {
  const text = card.lines.join("\n");
  return {
    exitCode: 1,
    json: { ok: false, card: text, hash: card.hash, problems: [{ file: "", path: "", message: sentence }] },
    text: `${text}\n\n${sentence}`,
  };
}

function isAnswerRefusal(refusal: TrustRefusal): refusal is AnswerRefusal {
  return Object.hasOwn(answerReasons, refusal.reason);
}

function refusalResult(refusal: TrustRefusal): CommandResult {
  return isAnswerRefusal(refusal) ? answerRefusalResult(refusal) : modeRefusalResult(refusal);
}

function modeRefusalResult(refusal: ModeRefusal): CommandResult {
  switch (refusal.reason) {
    case "no such mode":
      return refusedResult(`There is no mode ${shown(refusal.mode)} in this project or the kit, so nothing changed.`);
    case "inactive mode":
      return refusedResult(`The mode ${refusal.mode} is not active in this project, so nothing changed.`);
    case "lists nothing":
      return refusedResult(
        `The mode ${refusal.mode} lists no command and no throwaway folder, so it needs no trust. Nothing changed.`,
      );
    case "base mode":
      return refusedResult(
        `The mode ${refusal.mode} is in the kit's components/base/, so its list is granted with no trust. ` +
          "Nothing changed.",
      );
    case "already trusted":
      return refusedResult(
        `The mode ${refusal.given.list.mode} is already trusted for this list. ${trustedWhen(refusal.given)} ` +
          "Nothing changed.",
      );
    case "nothing to withdraw":
      return refusedResult(`The mode ${refusal.mode} is not trusted, so there is no trust to withdraw.`);
    case "unreadable record":
      return problemsResult(refusal.problems);
  }
}

function againCommand(ask: TrustAsk): string {
  return `bay approve --trust ${ask.mode}${rejectWords(ask)}`;
}

function answerRefusalResult(refusal: AnswerRefusal): CommandResult {
  switch (refusal.reason) {
    case "not a terminal":
      return withCard(refusal.card, notTerminalSentence(refusal.ask, refusal.card));
    case "not confirmed":
      return refusedResult(notConfirmed);
    case "chat is off":
      return refusedResult(
        `Trust from chat is off: approvals.from in agentbay.config.yaml lists ${refusal.allowed.join(", ")}.`,
        `The owner answers the card at a terminal: ${againCommand(refusal.ask)}. Only the owner changes approvals.from.`,
      );
    case "short hash":
      return refusedResult(
        `The hash ${shown(refusal.hash)} is the short form on the card; trust from chat needs the full hash.`,
        `The full hash is printed when ${againCommand(refusal.ask)} runs where its input is not a terminal.`,
      );
    case "another list":
      return refusedResult(
        `The hash ${shown(refusal.hash)} is not the hash on the card for the mode ${refusal.ask.mode} now, ` +
          "so nothing changed.",
        `Show the owner the card again: ${againCommand(refusal.ask)}.`,
      );
    case "quote lacks the mode":
      return refusedResult(
        `The owner's words ${shown(JSON.stringify(refusal.quote))} do not name the mode ${refusal.ask.mode}; ` +
          "an answer from chat counts only in words that name the mode.",
        `Ask the owner to answer the card in words that name ${refusal.ask.mode}.`,
      );
  }
}

type ScriptsNow = {
  readonly scripts: ScriptFiles;
  readonly changes: readonly ScriptFileChange[];
};

async function scriptFilesNow(kernel: Kernel, folder: string): Promise<ScriptFiles> {
  const paths = await kernel.ports.listing.projectFiles(folder);
  return scriptFilesOf(kernel.ports.files, folder, paths);
}

async function scriptsSince(kernel: Kernel, folder: string, given: TrustGiven): Promise<ScriptsNow> {
  const scripts = await scriptFilesNow(kernel, folder);
  return { scripts, changes: scriptFileChanges(given.scripts, scripts) };
}

async function trustedSubject(kernel: Kernel, folder: string, given: TrustGiven): Promise<TrustSubject | TrustRefusal> {
  const { scripts, changes } = await scriptsSince(kernel, folder, given);
  if (changes.length === 0) {
    return { reason: "already trusted", given };
  }
  const hash = hashOf({ list: given.hash, scripts });
  const lines = scriptsCard({ given, changes, hash });
  return { verdict: "record scripts", given, scripts, card: { lines, hash, prompt: prompts.scripts } };
}

function notNeeded(found: ActiveMode): TrustRefusal {
  const reason = hasList(listOf(found.manifest)) ? "base mode" : "lists nothing";
  return { reason, mode: found.manifest.name };
}

async function givingSubject(
  kernel: Kernel,
  found: ActiveMode,
  listTrust: Answerable,
): Promise<TrustSubject | TrustRefusal> {
  const { modeFolder } = found.grants;
  switch (listTrust.state) {
    case "trusted":
      return trustedSubject(kernel, modeFolder, listTrust.given);
    case "never trusted": {
      const folder = shownPath(kernel.layout, modeFolder);
      const lines = trustCard({ list: listTrust.list, folder });
      return giving(listTrust.list, modeFolder, { lines, prompt: prompts.first });
    }
    case "changed": {
      const { list, given } = listTrust;
      const { changes } = await scriptsSince(kernel, modeFolder, given);
      const lines = differenceCard({ list, given, changedScripts: changes.length });
      return giving(list, modeFolder, { lines, prompt: prompts.changed });
    }
  }
}

function withdrawingSubject(found: ActiveMode, listTrust: Answerable): TrustSubject | TrustRefusal {
  return listTrust.state === "never trusted"
    ? { reason: "nothing to withdraw", mode: found.manifest.name }
    : withdrawing(listTrust.given);
}

async function subjectOf(kernel: Kernel, ask: TrustAsk): Promise<TrustSubject | TrustRefusal> {
  const found = kernel.system.modes.get(ask.mode);
  if (found === undefined) {
    return { reason: kernel.system.inactive.has(ask.mode) ? "inactive mode" : "no such mode", mode: ask.mode };
  }
  const { listTrust } = found.grants;
  if (listTrust.state === "not needed") {
    return notNeeded(found);
  }
  if (listTrust.state === "unreadable record") {
    return { reason: "unreadable record", problems: listTrust.problems };
  }
  return ask.verdict === "give" ? givingSubject(kernel, found, listTrust) : withdrawingSubject(found, listTrust);
}

function hasList(list: ModeList): boolean {
  return list.commands.length > 0 || list.throwaway.length > 0;
}

function giving(list: ModeList, modeFolder: string, shownCard: Omit<Card, "hash">): TrustSubject {
  return { verdict: "give", list, modeFolder, card: { ...shownCard, hash: listHashOf(list) } };
}

function withdrawing(given: TrustGiven): TrustSubject {
  return {
    verdict: "withdraw",
    given,
    card: { lines: withdrawCard(given), hash: given.hash, prompt: prompts.withdraw },
  };
}

function chatRefusal(kernel: Kernel, ask: TrustAsk, card: Card): TrustRefusal | undefined {
  const { channel } = ask;
  if (channel.via === "terminal") {
    return undefined;
  }
  const allowed = allowedChannels(kernel);
  if (!allowed.includes("chat")) {
    return { reason: "chat is off", ask, allowed };
  }
  if (channel.hash !== card.hash) {
    const short = channel.hash !== "" && card.hash.startsWith(channel.hash);
    return { reason: short ? "short hash" : "another list", ask, hash: channel.hash };
  }
  return channel.quote.includes(ask.mode) ? undefined : { reason: "quote lacks the mode", ask, quote: channel.quote };
}

async function answerRefusal(request: TrustRequest, card: Card): Promise<TrustRefusal | undefined> {
  const { invocation, kernel, ask } = request;
  if (ask.channel.via === "chat") {
    return chatRefusal(kernel, ask, card);
  }
  const { terminal } = invocation.context;
  if (!terminal.isInteractive()) {
    return { reason: "not a terminal", ask, card };
  }
  const confirmed = await typedYes(terminal, `${card.lines.join("\n")}\n${card.prompt}`);
  return confirmed ? undefined : { reason: "not confirmed" };
}

async function written(request: TrustRequest, subject: TrustSubject): Promise<CommandResult> {
  const { kernel, ask } = request;
  const record = await readTrustRecord(kernel.ports.files, kernel.layout);
  if (!record.ok) {
    return refusalResult({ reason: "unreadable record", problems: record.problems });
  }
  const ports = { files: kernel.ports.files, folders: kernel.ports.folders };
  const by = byOf(ask.channel);
  const at = kernel.ports.clock.now().toISOString();
  switch (subject.verdict) {
    case "withdraw":
      await writeTrustRecord(ports, kernel.layout, recordWithoutTrust(record.value, ask.mode));
      return succeeded(
        { withdrawn: ask.mode },
        `Trust withdrawn from ${ask.mode}. From the next step, its scripts may not run its commands.`,
      );
    case "give": {
      const scripts = await scriptFilesNow(kernel, subject.modeFolder);
      await writeTrustRecord(ports, kernel.layout, recordWithTrust(record.value, subject.list, { scripts, at, by }));
      return succeeded(
        { trusted: ask.mode, hash: subject.card.hash, by },
        `${ask.mode} is trusted: ${listSize(subject.list)}. Its scripts may run its commands from the next step.`,
      );
    }
    case "record scripts": {
      const giving = { scripts: subject.scripts, at, by };
      await writeTrustRecord(ports, kernel.layout, recordWithTrust(record.value, subject.given.list, giving));
      return succeeded(
        { recorded: ask.mode, hash: subject.given.hash, by },
        `The script files of ${ask.mode} are recorded as you read them. Its list is trusted as before.`,
      );
    }
  }
}

async function decideTrust(request: TrustRequest): Promise<CommandResult> {
  const subject = await subjectOf(request.kernel, request.ask);
  if ("reason" in subject) {
    return refusalResult(subject);
  }
  const refusal = await answerRefusal(request, subject.card);
  return refusal === undefined ? written(request, subject) : refusalResult(refusal);
}

function runTrust(invocation: Invocation, mode: string): Promise<CommandResult> {
  const { positionals } = invocation;
  const channel = trustChannelOf(invocation);
  if (positionals.length > 0) {
    return Promise.resolve(
      usageResult(
        `bay approve --trust <mode> takes no other argument, but ${String(positionals.length)} were given.`,
        usage,
      ),
    );
  }
  if (typeof channel === "string") {
    return Promise.resolve(usageResult(channel, usage));
  }
  const ask: TrustAsk = { mode, verdict: invocation.flags.has("reject") ? "withdraw" : "give", channel };
  return withKernel(invocation, (kernel) => decideTrust({ invocation, kernel, ask }));
}

function runApprove(invocation: Invocation): Promise<CommandResult> {
  const mode = invocation.values.get("trust");
  return mode === undefined ? runApproval(invocation) : runTrust(invocation, mode);
}

export const approveCommand: Command = {
  name: "approve",
  summary:
    "Approve or reject what a waiting approval shows, naming its hash; or, with --trust, give or withdraw trust in " +
    "a mode's list. From a terminal, or from chat if allowed.",
  usage,
  options: [
    { name: "hash", takesValue: true },
    { name: "reject", takesValue: false },
    { name: "via", takesValue: true },
    { name: "quote", takesValue: true },
    { name: "trust", takesValue: true },
  ],
  positionals: { least: 0, most: 2 },
  handler: runApprove,
};
