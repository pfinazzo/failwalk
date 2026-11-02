import fs from "node:fs";
import path from "node:path";
import type { Inventory } from "../inventory/types";
import { mergeTraces, type TraceSummary } from "../tracer/mergeTraces";
import { readTraceRecords } from "../tracer/traceFile";
import { baseJestArgs, runnerEnv } from "./jestArgs";
import { runJest, type JestRun } from "./runJest";
import type { RunContext } from "./runCell";

/** The baseline run: the whole suite once, traced, with nothing injected. */
export type Baseline = { run: JestRun; trace: TraceSummary };

/** How long the whole baseline may take before failwalk kills it. A suite that needs longer is not a v1 target. */
const BASELINE_KILL_MS = 10 * 60 * 1000;

/**
 * Runs the project's suite once with the tracer loaded and merges the records it wrote.
 * Throws when no record was written, because that means the config override never loaded the setup file and a plan built from it would be empty.
 *
 * @param params.inventory - the inventory the tracer matches against
 * @param params.context - the shared run settings
 * @returns the runner's results and the merged trace
 */
export const runBaseline = async ({ inventory, context }: { inventory: Inventory; context: RunContext }): Promise<Baseline> => {
  const baselineDir = path.join(context.workDir, "baseline");
  fs.rmSync(baselineDir, { recursive: true, force: true });
  fs.mkdirSync(baselineDir, { recursive: true });
  const traceDir = path.join(baselineDir, "trace");
  const outputFile = path.join(baselineDir, "jest.json");
  const run = await runJest({
    jestBin: context.jestBin,
    args: baseJestArgs({ config: context.config, outputFile, testTimeoutMs: context.testTimeoutMs }),
    env: runnerEnv({ base: context.env, inventoryFile: context.inventoryFile, traceDir, setupFile: context.setupFile, injection: null }),
    cwd: context.root,
    outputFile,
    killAfterMs: BASELINE_KILL_MS,
  });
  const records = readTraceRecords({ traceDir });
  if (records.length === 0) {
    throw new Error(
      `failwalk: the baseline run wrote no trace records. Check that ${context.config} loads the setup file through setupFilesAfterEnv.\n${run.stderrTail}`,
    );
  }
  return { run, trace: mergeTraces({ records, inventory, inventoryFile: context.inventoryFile }) };
};
