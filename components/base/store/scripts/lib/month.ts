export function monthOf(time: Date): string {
  return time.toISOString().slice(0, 7);
}

export function roundedUsd(usd: number): number {
  return Math.round(usd * 1e9) / 1e9;
}
