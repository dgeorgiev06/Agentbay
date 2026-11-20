type GoAhead = "build" | "build-without-interface";

export type StartChoices = {
  readonly offered: Readonly<Record<GoAhead, boolean>>;
  readonly withheld: Partial<Record<GoAhead, string>>;
};

const named: StartChoices = {
  offered: { build: true, "build-without-interface": false },
  withheld: { "build-without-interface": "The slice names its interface files." },
};

const unnamed: StartChoices = {
  offered: { build: false, "build-without-interface": true },
  withheld: { build: "The slice names no interface files." },
};

export function startChoices(interfaceFiles: readonly string[]): StartChoices {
  return interfaceFiles.length > 0 ? named : unnamed;
}

export function stopReason(choice: string): string | undefined {
  return choice === "stop" ? "The owner chose stop on the start card, so nothing is cut." : undefined;
}
