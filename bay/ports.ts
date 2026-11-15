export type FileSystem = {
  readonly readText: (path: string) => Promise<string | undefined>;
  readonly list: (directory: string) => Promise<readonly string[]>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly writeAtomic: (path: string, text: string) => Promise<void>;
};

export type Folders = {
  readonly ensureOwnerOnlyFile: (file: string) => Promise<void>;
};

export type Removal = {
  readonly remove: (path: string) => Promise<void>;
};

export type Clock = {
  readonly now: () => Date;
};

export type Git = {
  readonly headCommit: (directory: string) => Promise<string>;
  readonly changedFiles: (directory: string, base: string) => Promise<readonly string[]>;
};

export type ProcessRequest = {
  readonly command: string;
  readonly arguments: readonly string[];
  readonly directory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMilliseconds: number;
  readonly input?: string;
};

export type ProcessResult = {
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
};

export type Processes = {
  readonly run: (request: ProcessRequest) => Promise<ProcessResult>;
};

export type HttpRequest = {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
};

export type HttpResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

export type Http = {
  readonly request: (request: HttpRequest) => Promise<HttpResponse>;
};

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
