import type { ProcessRequest } from "./ports.ts";

const gitReadingSeconds = 30;

export type GitPlace = {
  readonly directory: string;
  readonly searchPath: string;
};

export function gitReading(words: readonly string[], place: GitPlace): ProcessRequest {
  return {
    command: "git",
    arguments: ["-c", "core.fsmonitor=false", "--no-optional-locks", ...words],
    directory: place.directory,
    environment: { PATH: place.searchPath, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    timeoutMilliseconds: gitReadingSeconds * 1000,
  };
}
