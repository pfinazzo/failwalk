#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_IGNORE, formatInventorySummary, scanInventory } from "./inventory/scan";
import { loadInventory } from "./tracer/loadInventory";
import { formatTraceSummary, mergeTraces } from "./tracer/mergeTraces";
import { inventoryPath, traceDirPath } from "./tracer/paths";
import { readTraceRecords } from "./tracer/traceFile";

/** Options of `failwalk inventory`, as commander parses them. */
type InventoryOptions = { root: string; wrappers: string; out: string; ignore: string[] };

/** Options of `failwalk trace`, as commander parses them. */
type TraceOptions = { inventory: string; traceDir?: string; out: string; clear: boolean };

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
  .command("setup-path")
  .description("Print the path of the Jest setup file, for setupFilesAfterEnv in a config override.")
  .action(printSetupPath);

program.parseAsync(process.argv).catch((error: Error) => {
  process.stderr.write(`failwalk: ${error.message}\n`);
  process.exit(1);
});
