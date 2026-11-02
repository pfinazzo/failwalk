/**
 * Runs `work` over every item with at most `concurrency` in flight at once, and returns the results in item order.
 * This is the one bounded loop in failwalk: each worker takes the next unclaimed item, recursively, until none are left.
 * A rejected item rejects the whole pool; the runner never rejects, it returns evidence instead.
 *
 * @param params.items - the work items, in order
 * @param params.concurrency - how many may run at once; at least 1
 * @param params.work - runs one item
 * @returns the results, one per item, in the items' order
 */
export const runPool = async <Item, Result>({
  items,
  concurrency,
  work,
}: {
  items: readonly Item[];
  concurrency: number;
  work: (params: { item: Item; index: number }) => Promise<Result>;
}): Promise<Result[]> => {
  const results: Result[] = new Array<Result>(items.length);
  // The pool's own cursor: the next item no worker has claimed. Local to this call, owned by it.
  const cursor = { next: 0 };
  /**
   * One worker: claims the next item, runs it, stores its result, then claims again until the items run out.
   *
   * @returns resolves when this worker finds no item left
   */
  const drain = async (): Promise<void> => {
    const index = cursor.next;
    if (index >= items.length) return;
    cursor.next = index + 1;
    results[index] = await work({ item: items[index], index });
    return drain();
  };
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => drain());
  await Promise.all(workers);
  return results;
};
