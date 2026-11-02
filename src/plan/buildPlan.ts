import path from "node:path";
import type { Inventory } from "../inventory/types";
import type { TraceSummary } from "../tracer/mergeTraces";
import { MODE_NAMES, type ModeName } from "../tracer/modes";

/** One test an injection run will be filtered to. */
export type PlannedTest = {
  /** Absolute path of the test file. */
  testPath: string;
  /** The test file relative to the project root, with forward slashes, for reading. */
  file: string;
  /** The test's full name as the runner reports it: describe names then the test name. */
  name: string;
};

/** One (call site, mode) pair. `verdict` is UNREACHED when no test reached the site; otherwise the run fills it in. */
export type PlanCell = {
  site: string;
  wrapper: string;
  mode: ModeName;
  tests: PlannedTest[];
  verdict: "UNREACHED" | null;
};

/** The plan written as `failwalk-plan.json`. */
export type Plan = {
  generatedAt: string;
  root: string;
  modes: ModeName[];
  cells: PlanCell[];
};

/**
 * Lists, per inventory id, the tests that reached it, from the trace's per-test records. Tests whose file the runner cannot name are left out.
 *
 * @param params.trace - the merged trace
 * @param params.root - project root, which test files are made relative to
 * @returns site id to its tests, sorted by file then name
 */
const testsBySite = ({ trace, root }: { trace: TraceSummary; root: string }): Record<string, PlannedTest[]> =>
  trace.tests
    .filter((test) => test.testPath !== null)
    .flatMap((test) =>
      test.sites.map((site) => ({
        site,
        test: { testPath: test.testPath as string, file: path.relative(root, test.testPath as string).split(path.sep).join("/"), name: test.name },
      })),
    )
    .reduce<Record<string, PlannedTest[]>>(
      (acc, { site, test }) => ({ ...acc, [site]: [...(acc[site] || []), test].sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name)) }),
      {},
    );

/**
 * Builds one cell per (call site, mode) pair. Pure. A site no test reached gets empty tests and the verdict UNREACHED, so the run skips it.
 *
 * @param params.inventory - the inventory the trace was matched against
 * @param params.trace - the merged baseline trace
 * @param params.modes - the modes to plan, in grid order
 * @param params.now - timestamp for the plan
 * @returns the plan, cells in inventory order then mode order
 */
export const buildPlan = ({
  inventory,
  trace,
  modes = MODE_NAMES,
  now = new Date(),
}: {
  inventory: Inventory;
  trace: TraceSummary;
  modes?: readonly ModeName[];
  now?: Date;
}): Plan => {
  const reached = testsBySite({ trace, root: inventory.root });
  const cells = inventory.sites.flatMap((site) =>
    modes.map((mode) => {
      const tests = reached[site.id] || [];
      return { site: site.id, wrapper: site.wrapper, mode, tests, verdict: tests.length === 0 ? ("UNREACHED" as const) : null };
    }),
  );
  return { generatedAt: now.toISOString(), root: inventory.root, modes: [...modes], cells };
};

/**
 * Formats the plan for the terminal: how many cells will run, how many are UNREACHED, and the tests per planned site.
 *
 * @param params.plan - a built plan
 * @returns multi-line text
 */
export const formatPlanSummary = ({ plan }: { plan: Plan }): string => {
  const planned = plan.cells.filter((cell) => cell.verdict === null);
  const unreached = plan.cells.filter((cell) => cell.verdict === "UNREACHED");
  const sites = [...new Set(planned.map((cell) => cell.site))];
  const header = `failwalk plan: ${plan.cells.length} cells (${sites.length} reached sites × ${plan.modes.length} modes). ${planned.length} to run, ${unreached.length} UNREACHED.`;
  const rows = sites.flatMap((site) => {
    const { tests } = planned.find((cell) => cell.site === site) as PlanCell;
    return [`${site}   ${tests.length} test${tests.length === 1 ? "" : "s"}`, ...tests.map((test) => `    ${test.file} › ${test.name}`)];
  });
  return [header, "", ...rows].join("\n");
};
