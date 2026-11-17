import { testItemsSource } from "../../../base/interfaces/items-source/tests/shared.ts";

const baseDate = "2026-11-15T12:00:00.000Z";

testItemsSource({
  mode: "fake-source",
  start: () =>
    Promise.resolve({
      settings: { baseDate, pageSize: 10, costPerItemUsd: 0.002 },
      startAt: baseDate,
      stop: () => Promise.resolve(),
    }),
  walk: { pages: [10, 10, 10], cost: { items: 30, usd: 0.06 } },
});
