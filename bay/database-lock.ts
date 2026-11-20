export const databaseLockWaitMilliseconds = 3000;

const busyCode = 5;

const lockedCode = 6;

const extendedCodeBase = 256;

const lockedMessage = /database (table )?is (locked|busy)/;

function primaryCode(error: Error): number | undefined {
  const code = "errcode" in error ? error.errcode : undefined;
  return typeof code === "number" ? code % extendedCodeBase : undefined;
}

export function isLockedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = primaryCode(error);
  return code === busyCode || code === lockedCode || lockedMessage.test(error.message);
}
