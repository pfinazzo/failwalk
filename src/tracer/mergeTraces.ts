import path from "node:path";
import type { Inventory } from "../inventory/types";
import type { Injection } from "./injection";
import type { Reach } from "./siteIndex";
import type { TraceRecord } from "./traceFile";

/** One test and what it reached, in the merged file. */
export type MergedTest = { testPath: string | null; name: string; sites: string[]; uninventoried: string[] };

/** A wrapper call no inventory record matches, with every test that made it. */
export type Uninventoried = Reach & { tests: string[] };

/** The merged `failwalk-trace.json`. */
export type TraceSummary = {
  generatedAt: string;
  inventory: string;
  testFiles: number;
  tests: MergedTest[];
  /** Inventory id to the tests that reached it. */
  sites: Record<string, string[]>;
  /** Inventory ids no test reached. */
  unreached: string[];
  UNINVENTORIED: Uninventoried[];
  injection: (Injection & { fired: number }) | null;
};

/**
 * Labels a test as `<file> › <name>`, with the file relative to the root.
 *
 * @param params.testPath - absolute test file, or null
 * @param params.name - full test name
 * @param params.root - inventory root
 * @returns the label
 */
const testLabel = ({ testPath, name, root }: { testPath: string | null; name: string; root: string }): string =>
  `${testPath ? path.relative(root, testPath).split(path.sep).join("/") : "(unknown file)"} › ${name}`;

/**
 * Adds one test's label under every id it reached. Labels stay sorted so the output does not depend on test order.
 *
 * @param params.acc - id to test labels so far
 * @param params.ids - ids one test reached
 * @param params.label - that test's label
 * @returns the extended accumulator
 */
const addReaches = ({ acc, ids, label }: { acc: Record<string, string[]>; ids: readonly string[]; label: string }): Record<string, string[]> =>
  ids.reduce((inner, id) => ({ ...inner, [id]: [...(inner[id] || []), label].sort() }), acc);

/**
 * Sums the injection counters across records. Pure.
 *
 * @param params.records - per-file trace records
 * @returns the injection with the total fired count, or null when no record had one
 */
const mergeInjection = ({ records }: { records: readonly TraceRecord[] }): TraceSummary["injection"] => {
  const withInjection = records.flatMap((record) => (record.injection ? [record.injection] : []));
  if (withInjection.length === 0) return null;
  return { ...withInjection[0], fired: withInjection.reduce((sum, { fired }) => sum + fired, 0) };
};

/**
 * Merges every per-file trace record with the inventory into the summary written as `failwalk-trace.json`. Pure.
 *
 * @param params.records - per-file trace records
 * @param params.inventory - the inventory they were matched against
 * @param params.inventoryFile - where that inventory lives, for the summary header
 * @param params.now - timestamp for the summary
 * @returns the summary
 */
export const mergeTraces = ({
  records,
  inventory,
  inventoryFile,
  now = new Date(),
}: {
  records: readonly TraceRecord[];
  inventory: Inventory;
  inventoryFile: string;
  now?: Date;
}): TraceSummary => {
  const { root } = inventory;
  const tests = records
    .flatMap((record) => record.tests)
    .map((test) => ({ ...test, uninventoried: test.uninventoried.map(({ id }) => id) }))
    .sort((a, b) => testLabel({ ...a, root }).localeCompare(testLabel({ ...b, root })));
  const sites = records
    .flatMap((record) => record.tests)
    .reduce<Record<string, string[]>>((acc, test) => addReaches({ acc, ids: test.sites, label: testLabel({ ...test, root }) }), {});
  const uninventoriedById = records
    .flatMap((record) => record.tests)
    .flatMap((test) => test.uninventoried.map((reach) => ({ reach, label: testLabel({ ...test, root }) })))
    .reduce<Record<string, Uninventoried>>(
      (acc, { reach, label }) => ({ ...acc, [reach.id]: { ...reach, tests: [...(acc[reach.id]?.tests || []), label].sort() } }),
      {},
    );
  return {
    generatedAt: now.toISOString(),
    inventory: inventoryFile,
    testFiles: records.length,
    tests,
    sites,
    unreached: inventory.sites.map(({ id }) => id).filter((id) => !(id in sites)),
    UNINVENTORIED: Object.values(uninventoriedById).sort((a, b) => a.id.localeCompare(b.id)),
    injection: mergeInjection({ records }),
  };
};

/**
 * Formats the trace summary for the terminal: reached sites with their tests, then unreached sites, then UNINVENTORIED calls.
 *
 * @param params.summary - a merged trace
 * @param params.totalSites - how many sites the inventory has
 * @returns multi-line text
 */
export const formatTraceSummary = ({ summary, totalSites }: { summary: TraceSummary; totalSites: number }): string => {
  const reached = Object.entries(summary.sites).sort(([a], [b]) => a.localeCompare(b));
  const header = `failwalk trace: ${summary.tests.length} tests in ${summary.testFiles} files reached ${reached.length} of ${totalSites} call sites. ${summary.unreached.length} UNREACHED, ${summary.UNINVENTORIED.length} UNINVENTORIED.`;
  const reachedRows = reached.flatMap(([id, tests]) => [`${id}   ${tests.length} test${tests.length === 1 ? "" : "s"}`, ...tests.map((test) => `    ${test}`)]);
  const unreachedRows = summary.unreached.length ? ["", "UNREACHED (no test reaches these):", ...summary.unreached.map((id) => `    ${id}`)] : [];
  const uninventoriedRows = summary.UNINVENTORIED.length
    ? [
        "",
        "UNINVENTORIED (the tracer saw these, the inventory did not):",
        ...summary.UNINVENTORIED.flatMap(({ wrapper, method, file, line, tests }) => [
          `    ${wrapper}.${method} at ${file}:${line}`,
          ...tests.map((test) => `        ${test}`),
        ]),
      ]
    : [];
  const injectionRows = summary.injection
    ? ["", `injection: ${summary.injection.mode} at ${summary.injection.site}, fired ${summary.injection.fired} time${summary.injection.fired === 1 ? "" : "s"}`]
    : [];
  return [header, "", ...reachedRows, ...unreachedRows, ...uninventoriedRows, ...injectionRows].join("\n");
};
