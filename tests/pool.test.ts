import { describe, expect, test } from "vitest";
import { runPool } from "../src/run/pool";

/**
 * Runs the pool over `count` items that each take a few milliseconds, recording how many are in flight at once.
 *
 * @param params.count - how many items
 * @param params.concurrency - the bound to test
 * @returns the results and the highest number in flight at any moment
 */
const measure = async ({ count, concurrency }: { count: number; concurrency: number }): Promise<{ results: number[]; peak: number }> => {
  // Counters the fake work updates; local to this measurement.
  const inFlight = { now: 0, peak: 0 };
  const results = await runPool({
    items: Array.from({ length: count }, (_, index) => index),
    concurrency,
    work: async ({ item, index }) => {
      inFlight.now += 1;
      inFlight.peak = Math.max(inFlight.peak, inFlight.now);
      await new Promise((resolve) => setTimeout(resolve, 5 + (index % 3) * 3));
      inFlight.now -= 1;
      return item * 10;
    },
  });
  return { results, peak: inFlight.peak };
};

describe("the bounded pool (criterion 3)", () => {
  test("never has more than the concurrency in flight, and returns results in item order", async () => {
    const { results, peak } = await measure({ count: 12, concurrency: 4 });
    expect(peak).toBe(4);
    expect(results).toEqual(Array.from({ length: 12 }, (_, index) => index * 10));
  });

  test("runs more than one at a time by default sizes", async () => {
    const { peak } = await measure({ count: 6, concurrency: 3 });
    expect(peak).toBeGreaterThan(1);
  });

  test("a concurrency of 1 runs the items one after another", async () => {
    const { results, peak } = await measure({ count: 5, concurrency: 1 });
    expect(peak).toBe(1);
    expect(results).toHaveLength(5);
  });

  test("more workers than items, or no items, is fine", async () => {
    const { results, peak } = await measure({ count: 2, concurrency: 8 });
    expect(peak).toBe(2);
    expect(results).toEqual([0, 10]);
    await expect(runPool({ items: [], concurrency: 4, work: async () => 1 })).resolves.toEqual([]);
  });
});
