export type EntryKind = "file" | "directory" | "link" | "other";

export type DirectoryEntry = {
  readonly name: string;
  readonly kind: EntryKind;
};

export type FileInspector = {
  readonly realPath: (path: string) => Promise<string | undefined>;
  readonly isLink: (path: string) => Promise<boolean>;
  readonly entries: (directory: string) => Promise<readonly DirectoryEntry[]>;
};

export type ChildRequest = {
  readonly command: string;
  readonly arguments: readonly string[];
  readonly directory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMilliseconds: number;
  readonly maximumOutputBytes: number;
};

export type ChildEnd =
  | { readonly how: "exited"; readonly exitCode: number; readonly errorOutput: string }
  | { readonly how: "signalled"; readonly signal: string; readonly errorOutput: string }
  | { readonly how: "timed-out"; readonly errorOutput: string }
  | { readonly how: "output-exceeded"; readonly errorOutput: string }
  | { readonly how: "not-started"; readonly errorOutput: string };

export type Child = {
  readonly send: (line: string) => void;
  readonly kill: () => void;
  readonly ended: Promise<ChildEnd>;
};

export type ChildProcesses = {
  readonly start: (request: ChildRequest, onLine: (line: string) => void) => Child;
};
