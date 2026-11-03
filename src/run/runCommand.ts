import fs from "node:fs";
import path from "node:path";
import { formatInventorySummary, scanInventory } from "../inventory/scan";
import type { Inventory } from "../inventory/types";
import { buildPlan, formatPlanSummary, type Plan, type PlanCell } from "../plan/buildPlan";
import { formatTraceSummary, type TraceSummary } from "../tracer/mergeTraces";
import { MODE_NAMES, type ModeName } from "../tracer/modes";
import { verdictFor, type CellEvidence } from "../verdicts";
import { runBaseline } from "./baseline";
import { runPool } from "./pool";
import { countVerdicts, coveredFraction, exitCodeFor, formatGrid, formatHeadline, type CellResult, type VerdictCounts } from "./report";
import { runCell, type RunContext } from "./runCell";
import { resolveJestBin, SETUP_FILE } from "./runJest";

/** What `failwalk run` takes. */
export type RunOptions = {
  root: string;
  wrappers: string;
  ignore?: readonly string[];
  /** The project's config override that loads the setup file. Defaults to jest.failwalk.config.js under root. */
  config?: string;
  /** Where failwalk-inventory.json, failwalk-trace.json, failwalk-plan.json and failwalk.json go, with the .failwalk work folder beside them. */
  outDir: string;
  /** Where the baseline and cell folders go. Defaults to .failwalk under outDir. */
  workDir?: string;
  concurrency: number;
  minCoverage: number;
  testTimeoutMs: number;
  modes?: readonly ModeName[];
  /** Progress lines go here while cells run. */
  log: (params: { line: string }) => void;
};

/** The file written as `failwalk.json`: the source of truth for a run. */
export type RunReport = {
  generatedAt: string;
  root: string;
  wrappers: string;
  config: string;
  concurrency: number;
  testTimeoutMs: number;
  inventory: Inventory;
  trace: TraceSummary;
  plan: Plan;
  cells: CellResult[];
  counts: VerdictCounts;
  covered: number;
  headline: string;
};

/** The default name of the project's config override. */
const DEFAULT_CONFIG = "jest.failwalk.config.js";

/**
 * Finds the config override: the one given, else jest.failwalk.config.js under the root. Throws when it is missing, saying how to add one.
 *
 * @param params.root - the project folder
 * @param params.config - the override path from the options, or undefined
 * @returns an absolute path
 */
const resolveConfig = ({ root, config }: { root: string; config?: string }): string => {
  const resolved = path.resolve(root, config ?? DEFAULT_CONFIG);
  if (!fs.existsSync(resolved)) {
    throw new Error(`failwalk: no config override at ${resolved}. Add one that appends the setup file (failwalk setup-path) to setupFilesAfterEnv, or pass --config.`);
  }
  return resolved;
};

/**
 * Joins a planned cell with its evidence into the cell written to failwalk.json. UNREACHED cells have no evidence.
 *
 * @param params.cell - the planned cell
 * @param params.evidence - the cell's evidence, or null when it did not run
 * @param params.checks - the static checks that fired on the cell's site
 * @returns the cell with its verdict and its checks
 */
const toCellResult = ({ cell, evidence, checks }: { cell: PlanCell; evidence: CellEvidence | null; checks: readonly string[] }): CellResult => ({
  site: cell.site,
  wrapper: cell.wrapper,
  mode: cell.mode,
  tests: cell.tests,
  verdict: evidence ? verdictFor({ evidence, checks }) : "UNREACHED",
  checks: [...checks],
  evidence,
});

/**
 * Runs the whole walk: inventory, traced baseline, plan, one runner process per planned cell through the pool, verdicts.
 * Writes failwalk-inventory.json, failwalk-trace.json, failwalk-plan.json and failwalk.json into outDir and the work files under outDir/.failwalk.
 *
 * @param params - see RunOptions
 * @returns the report and the exit code
 */
export const runWalk = async ({ root, wrappers, ignore, config, outDir, workDir, concurrency, minCoverage, testTimeoutMs, modes = MODE_NAMES, log }: RunOptions): Promise<{ report: RunReport; exitCode: number }> => {
  const absoluteRoot = path.resolve(root);
  const absoluteOut = path.resolve(outDir);
  fs.mkdirSync(absoluteOut, { recursive: true });
  const inventoryFile = path.join(absoluteOut, "failwalk-inventory.json");
  const context: RunContext = {
    root: absoluteRoot,
    config: resolveConfig({ root: absoluteRoot, config }),
    jestBin: resolveJestBin({ root: absoluteRoot }),
    inventoryFile,
    workDir: path.resolve(workDir ?? path.join(absoluteOut, ".failwalk")),
    setupFile: SETUP_FILE,
    testTimeoutMs,
    env: process.env,
  };

  const inventory = await scanInventory({ root: absoluteRoot, wrappers, ignore });
  fs.writeFileSync(inventoryFile, JSON.stringify(inventory, null, 2));
  log({ line: formatInventorySummary({ inventory }) });

  log({ line: "baseline: running the suite once with the tracer loaded" });
  const { trace } = await runBaseline({ inventory, context });
  fs.writeFileSync(path.join(absoluteOut, "failwalk-trace.json"), JSON.stringify(trace, null, 2));
  log({ line: formatTraceSummary({ summary: trace, totalSites: inventory.sites.length }).split("\n")[0] });

  const plan = buildPlan({ inventory, trace, modes });
  fs.writeFileSync(path.join(absoluteOut, "failwalk-plan.json"), JSON.stringify(plan, null, 2));
  log({ line: formatPlanSummary({ plan }).split("\n")[0] });

  const checksBySite = inventory.sites.reduce<Record<string, readonly string[]>>((acc, site) => ({ ...acc, [site.id]: site.checks }), {});
  const planned = plan.cells.map((cell, index) => ({ cell, index })).filter(({ cell }) => cell.verdict === null);
  const results = await runPool({
    items: planned,
    concurrency,
    work: async ({ item, index }) => {
      const evidence = await runCell({ cell: item.cell, index: item.index, context });
      const result = toCellResult({ cell: item.cell, evidence, checks: checksBySite[item.cell.site] ?? [] });
      log({
        line: `[${index + 1}/${planned.length}] ${result.verdict.padEnd(6)} ${item.cell.mode.padEnd(9)} ${item.cell.site}  (${(evidence.durationMs / 1000).toFixed(1)}s, fired ${evidence.fired})`,
      });
      return result;
    },
  });
  const resultsBySite = results.reduce<Record<string, CellResult>>((acc, result) => ({ ...acc, [`${result.site}\n${result.mode}`]: result }), {});
  const cells = plan.cells.map((cell) => resultsBySite[`${cell.site}\n${cell.mode}`] ?? toCellResult({ cell, evidence: null, checks: checksBySite[cell.site] ?? [] }));
  const covered = coveredFraction({ cells });
  const report: RunReport = {
    generatedAt: new Date().toISOString(),
    root: absoluteRoot,
    wrappers,
    config: context.config,
    concurrency,
    testTimeoutMs,
    inventory,
    trace,
    plan,
    cells,
    counts: countVerdicts({ cells }),
    covered,
    headline: formatHeadline({ sites: inventory.sites.length, modes: plan.modes.length, cells }),
  };
  fs.writeFileSync(path.join(absoluteOut, "failwalk.json"), JSON.stringify(report, null, 2));
  return { report, exitCode: exitCodeFor({ covered, minCoverage }) };
};

/**
 * Formats the full terminal output of a run: the grid, then the headline as the last line.
 *
 * @param params.report - the finished run
 * @returns multi-line text
 */
export const formatRun = ({ report }: { report: RunReport }): string =>
  [formatGrid({ cells: report.cells, modes: report.plan.modes }), "", report.headline].join("\n");
