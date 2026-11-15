export function stopsBeforePage(remainingUsd: number, pageCostUsd: number | undefined): boolean {
  return pageCostUsd === undefined ? remainingUsd <= 0 : remainingUsd < pageCostUsd;
}
