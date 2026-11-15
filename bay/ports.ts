export type FileSystem = {
  readonly readText: (path: string) => Promise<string | undefined>;
  readonly list: (directory: string) => Promise<readonly string[]>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly writeAtomic: (path: string, text: string) => Promise<void>;
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
