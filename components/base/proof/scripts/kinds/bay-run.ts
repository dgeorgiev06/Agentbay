export type BayRun =
  | { readonly ran: "ended"; readonly exitCode: number; readonly stdout: string }
  | { readonly ran: "not known"; readonly reason: string };
