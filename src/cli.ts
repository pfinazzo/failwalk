#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_IGNORE, formatInventorySummary, scanInventory } from "./inventory/scan";
import { buildPlan, formatPlanSummary } from "./plan/buildPlan";
import { formatRun, runWalk } from "./run/runCommand";
import { loadInventory } from "./tracer/loadInventory";
import { formatTraceSummary, mergeTraces, type TraceSummary } from "./tracer/mergeTraces";
import { MODE_NAMES, type ModeName } from "./tracer/modes";
import { inventoryPath, traceDirPath } from "./tracer/paths";
import { readTraceRecords } from "./tracer/traceFile";
import { loadScene, openInBrowser } from "./ui/load";
import { renderPage } from "./ui/render";

/** Options of `failwalk inventory`, as commander parses them. */
type InventoryOptions = { root: string; wrappers: string; out: string; ignore: string[] };

/** Options of `failwalk trace`, as commander parses them. */
type TraceOptions = { inventory: string; traceDir?: string; out: string; clear: boolean };

/** Options of `failwalk plan`, as commander parses them. */
type PlanOptions = { root: string; inventory: string; trace: string; out: string; modes: string[] };

/** Options of `failwalk run`, as commander parses them. */
type RunCliOptions = {
  root: string;
  wrappers: string;
  ignore: string[];
  config?: string;
  outDir: string;
  concurrency: string;
  minCoverage: string;
  testTimeoutMs: string;
  modes: string[];
};

/** Options of `failwalk ui`, as commander parses them. `open` is false after --no-open. */
type UiOptions = { inventory: string; trace: string; report: string; out: string; open: boolean };

/** The default number of runner processes in flight at once. */
const DEFAULT_CONCURRENCY = 4;

/** The default per-test timeout failwalk gives the runner, in milliseconds. */
const DEFAULT_TEST_TIMEOUT_MS = 10_000;

/**
 * Runs `failwalk inventory`: scans the project, writes the inventory file, prints the records to stdout and the summary to stderr.
 *
 * @param params.root - project folder to scan
 * @param params.wrappers - glob for wrapper modules, relative to root
 * @param params.out - where to write the full inventory
 * @param params.ignore - globs to skip
 */
const runInventory = async ({ root, wrappers, out, ignore }: InventoryOptions): Promise<void> => {
  const inventory = await scanInventory({ root, wrappers, ignore });
  fs.writeFileSync(out, JSON.stringify(inventory, null, 2));
  process.stdout.write(`${JSON.stringify(inventory.sites, null, 2)}\n`);
  process.stderr.write(`${formatInventorySummary({ inventory })}\nwritten to ${path.resolve(out)}\n`);
};

/**
 * Runs `failwalk trace`: merges the per-file records into failwalk-trace.json and prints the summary. With `clear`, deletes the records instead.
 * Throws when the trace folder holds no records, so a run that never loaded the setup file cannot look empty and clean.
 *
 * @param params.inventory - the inventory file the run was matched against
 * @param params.traceDir - folder of per-file records, or undefined for the default next to the inventory
 * @param params.out - where to write the merged trace
 * @param params.clear - delete the records instead of merging them
 */
const runTrace = ({ inventory: inventoryFile, traceDir, out, clear }: TraceOptions): void => {
  const resolvedInventory = path.resolve(inventoryFile);
  const resolvedTraceDir = traceDir ? path.resolve(traceDir) : traceDirPath({ env: process.env, inventoryFile: resolvedInventory });
  if (clear) {
    fs.rmSync(resolvedTraceDir, { recursive: true, force: true });
    process.stderr.write(`cleared ${resolvedTraceDir}\n`);
    return;
  }
  const inventory = loadInventory({ file: resolvedInventory });
  const records = readTraceRecords({ traceDir: resolvedTraceDir });
  if (records.length === 0) {
    throw new Error(`No trace records in ${resolvedTraceDir}. Run the suite with the setup file loaded first.`);
  }
  const summary = mergeTraces({ records, inventory, inventoryFile: resolvedInventory });
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  process.stdout.write(`${formatTraceSummary({ summary, totalSites: inventory.sites.length })}\n`);
  process.stderr.write(`written to ${path.resolve(out)}\n`);
};

/**
 * Checks that every requested mode name is in the table. Throws naming the bad one, so a typo cannot silently shrink the grid.
 *
 * @param params.modes - mode names from the command line
 * @returns the names typed as modes, or every mode when none were given
 */
const parseModes = ({ modes }: { modes: readonly string[] }): ModeName[] => {
  const unknown = modes.filter((mode) => !MODE_NAMES.includes(mode as ModeName));
  if (unknown.length > 0) throw new Error(`Unknown mode "${unknown[0]}". Known modes: ${MODE_NAMES.join(", ")}`);
  return modes.length === 0 ? [...MODE_NAMES] : (modes as ModeName[]);
};

/**
 * Parses a number option. Throws naming the option when the value is not a number.
 *
 * @param params.name - the option, for the error
 * @param params.value - the raw text
 * @returns the number
 */
const parseNumber = ({ name, value }: { name: string; value: string }): number => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new Error(`${name} must be a number, got "${value}"`);
  return parsed;
};

/**
 * Runs `failwalk plan`: builds one cell per (call site, mode) from the inventory and the merged trace, writes failwalk-plan.json and prints the summary.
 * Throws when the inventory was made for a different root than --root, which means the files in this folder belong to another project.
 *
 * @param params.root - the project folder the inventory must have been made for
 * @param params.inventory - the inventory file
 * @param params.trace - the merged trace file
 * @param params.out - where to write the plan
 * @param params.modes - mode names to plan, or empty for all
 */
const runPlan = ({ root, inventory: inventoryFile, trace: traceFile, out, modes }: PlanOptions): void => {
  const inventory = loadInventory({ file: path.resolve(inventoryFile) });
  if (path.resolve(root) !== inventory.root) {
    throw new Error(`The inventory at ${path.resolve(inventoryFile)} was made for ${inventory.root}, not ${path.resolve(root)}. Run "failwalk inventory" for this root first.`);
  }
  if (!fs.existsSync(traceFile)) throw new Error(`No trace at ${path.resolve(traceFile)}. Run "failwalk trace" first.`);
  const trace = JSON.parse(fs.readFileSync(traceFile, "utf8")) as TraceSummary;
  const plan = buildPlan({ inventory, trace, modes: parseModes({ modes }) });
  fs.writeFileSync(out, JSON.stringify(plan, null, 2));
  process.stdout.write(`${formatPlanSummary({ plan })}\n`);
  process.stderr.write(`written to ${path.resolve(out)}\n`);
};

/**
 * Runs `failwalk run`: the whole walk in one go. Progress goes to stderr; the table and the headline go to stdout, headline last.
 * Exits 1 when the covered fraction is below --min-coverage.
 *
 * @param params - the command's options, see RunCliOptions
 */
const runRun = async ({ root, wrappers, ignore, config, outDir, concurrency, minCoverage, testTimeoutMs, modes }: RunCliOptions): Promise<void> => {
  const { report, exitCode } = await runWalk({
    root,
    wrappers,
    ignore,
    config,
    outDir,
    concurrency: parseNumber({ name: "--concurrency", value: concurrency }),
    minCoverage: parseNumber({ name: "--min-coverage", value: minCoverage }),
    testTimeoutMs: parseNumber({ name: "--test-timeout-ms", value: testTimeoutMs }),
    modes: parseModes({ modes }),
    log: ({ line }) => process.stderr.write(`${line}\n`),
  });
  process.stderr.write(`written to ${path.join(path.resolve(outDir), "failwalk.json")}\n`);
  process.stdout.write(`${formatRun({ report })}\n`);
  process.exitCode = exitCode;
};

/**
 * Runs `failwalk ui`: shapes the inventory, the trace and the run report into one self-contained HTML page, writes it, and opens it in the browser.
 * Prints the page's path and, before a run is complete, the sentence saying what to run next.
 *
 * @param params.inventory - the inventory file, required
 * @param params.trace - the merged trace file, used when present
 * @param params.report - the run report, used when present
 * @param params.out - where to write the page
 * @param params.open - open the page once written
 */
const runUi = ({ inventory, trace, report, out, open }: UiOptions): void => {
  const scene = loadScene({ inventoryFile: path.resolve(inventory), traceFile: path.resolve(trace), reportFile: path.resolve(report) });
  fs.writeFileSync(out, renderPage({ scene }));
  const counts = `${scene.sites.length} call sites, ${scene.modes.length} modes, ${scene.tests.length} tests`;
  process.stderr.write(`failwalk ui: ${counts}. written to ${path.resolve(out)}\n${scene.notice ? `${scene.notice}\n` : ""}`);
  if (open) openInBrowser({ file: out, platform: process.platform });
};

/**
 * Runs `failwalk setup-path`: prints where the built Jest setup file is.
 */
const printSetupPath = (): void => {
  process.stdout.write(`${path.join(__dirname, "tracer", "setup.js")}\n`);
};

const program = new Command();

program.name("failwalk").description("Failure-mode coverage for dependency calls.").version("0.1.0");

program
  .command("inventory")
  .description("Find every call site that reaches a wrapper module. Prints one JSON record per site.")
  .option("--root <path>", "project folder to scan", ".")
  .option("--wrappers <glob>", "glob for wrapper modules, relative to root", "config/**/*.js")
  .option("--out <file>", "where to write the full inventory", "failwalk-inventory.json")
  .option("--ignore <globs...>", "globs to skip instead of the defaults", [...DEFAULT_IGNORE])
  .action(runInventory);

program
  .command("trace")
  .description("Merge the per-file trace records from a traced test run into failwalk-trace.json and print who reached what.")
  .option("--inventory <file>", "the inventory the run was matched against", inventoryPath({ env: process.env }))
  .option("--trace-dir <dir>", "folder of per-file records written by the setup file")
  .option("--out <file>", "where to write the merged trace", "failwalk-trace.json")
  .option("--clear", "delete the per-file records instead, before a fresh run", false)
  .action(runTrace);

program
  .command("plan")
  .description("Build one cell per (call site, mode) from failwalk-inventory.json and failwalk-trace.json, and write failwalk-plan.json.")
  .option("--root <path>", "the project folder the inventory was made for", ".")
  .option("--inventory <file>", "the inventory file", inventoryPath({ env: process.env }))
  .option("--trace <file>", "the merged trace file", "failwalk-trace.json")
  .option("--out <file>", "where to write the plan", "failwalk-plan.json")
  .option("--modes <names...>", "modes to plan instead of all of them", [])
  .action(runPlan);

program
  .command("run")
  .description("Inventory, trace, plan, then run every planned cell with its failure injected, and print the grid.")
  .option("--root <path>", "project folder to scan and test", ".")
  .option("--wrappers <glob>", "glob for wrapper modules, relative to root", "config/**/*.js")
  .option("--ignore <globs...>", "globs to skip in the inventory instead of the defaults", [...DEFAULT_IGNORE])
  .option("--config <file>", "the config override that loads the setup file, relative to root (default: jest.failwalk.config.js)")
  .option("--out-dir <dir>", "where the four output files and the .failwalk work folder go", ".")
  .option("--concurrency <n>", "how many runner processes may run at once", String(DEFAULT_CONCURRENCY))
  .option("--min-coverage <fraction>", "exit 1 when fewer than this fraction of cells are PASS or FAIL", "0")
  .option("--test-timeout-ms <ms>", "per-test timeout given to the runner", String(DEFAULT_TEST_TIMEOUT_MS))
  .option("--modes <names...>", "modes to run instead of all of them", [])
  .action(runRun);

program
  .command("ui")
  .description("Draw the grid as a 3D map in one self-contained HTML page, from failwalk-inventory.json, failwalk-trace.json and failwalk.json, and open it.")
  .option("--inventory <file>", "the inventory file", inventoryPath({ env: process.env }))
  .option("--trace <file>", "the merged trace file, used when it exists", "failwalk-trace.json")
  .option("--report <file>", "the run report, used when it exists", "failwalk.json")
  .option("--out <file>", "where to write the page", "failwalk-ui.html")
  .option("--no-open", "write the page without opening it")
  .action(runUi);

program
  .command("setup-path")
  .description("Print the path of the Jest setup file, for setupFilesAfterEnv in a config override.")
  .action(printSetupPath);

program.parseAsync(process.argv).catch((error: Error) => {
  process.stderr.write(`failwalk: ${error.message}\n`);
  process.exit(1);
});
