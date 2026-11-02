import fs from "node:fs";
import path from "node:path";
import type { PlanCell, PlannedTest } from "../plan/buildPlan";
import { readTraceRecords, type TraceRecord } from "../tracer/traceFile";
import { classifyFailure, type CellEvidence, type TestEvidence } from "../verdicts";
import { cellJestArgs, runnerEnv } from "./jestArgs";
import { runJest, type JestJson } from "./runJest";

/** Everything a cell run needs that does not change between cells. */
export type RunContext = {
  root: string;
  config: string;
  jestBin: string;
  inventoryFile: string;
  workDir: string;
  setupFile: string;
  testTimeoutMs: number;
  env: Record<string, string | undefined>;
};

/** How many characters of a failure message the evidence keeps. */
const MESSAGE_CHARS = 1500;

/** Extra time past every planned test's timeout before the whole runner process is killed. */
const KILL_GRACE_MS = 30_000;

/**
 * Names a cell's work folder: its index, then the site id and mode with every unsafe character replaced.
 *
 * @param params.cell - the cell
 * @param params.index - the cell's position in the plan
 * @returns a folder name
 */
export const cellDirName = ({ cell, index }: { cell: PlanCell; index: number }): string =>
  `${String(index).padStart(3, "0")}-${`${cell.site}-${cell.mode}`.replace(/[^A-Za-z0-9._-]+/g, "_")}`;

/**
 * Finds what the runner reported for one planned test, by its file and full name.
 *
 * @param params.test - the planned test
 * @param params.results - the runner's JSON results, or null when it wrote none
 * @returns the test's evidence; `missing` when the runner reported nothing for it
 */
const evidenceForTest = ({ test, results }: { test: PlannedTest; results: JestJson | null }): TestEvidence => {
  const assertion = results?.testResults
    .filter((suite) => suite.name === test.testPath)
    .flatMap((suite) => suite.assertionResults)
    .find((candidate) => candidate.fullName === test.name);
  if (!assertion || assertion.status === "pending") return { file: test.file, name: test.name, outcome: "missing", message: "" };
  if (assertion.status === "passed") return { file: test.file, name: test.name, outcome: "passed", message: "" };
  const message = (assertion.failureMessages[0] ?? "").slice(0, MESSAGE_CHARS);
  return { file: test.file, name: test.name, outcome: classifyFailure({ message }), message };
};

/**
 * Sums the injection counters over the trace records one run wrote.
 *
 * @param params.records - the run's trace records
 * @returns how many times the injection fired
 */
const firedCount = ({ records }: { records: readonly TraceRecord[] }): number =>
  records.reduce((sum, record) => sum + (record.injection?.fired ?? 0), 0);

/**
 * Runs one cell: a fresh runner process filtered to the cell's tests, with the cell's site and mode injected, in its own work folder.
 * Writes the folder under the work dir. Never throws for a failing or dying runner; that becomes evidence.
 *
 * @param params.cell - the planned cell, which has tests
 * @param params.index - the cell's position in the plan, for its folder name
 * @param params.context - the shared run settings
 * @returns the cell's evidence
 */
export const runCell = async ({ cell, index, context }: { cell: PlanCell; index: number; context: RunContext }): Promise<CellEvidence> => {
  const cellDir = path.join(context.workDir, "cells", cellDirName({ cell, index }));
  fs.rmSync(cellDir, { recursive: true, force: true });
  fs.mkdirSync(cellDir, { recursive: true });
  const traceDir = path.join(cellDir, "trace");
  const outputFile = path.join(cellDir, "jest.json");
  const run = await runJest({
    jestBin: context.jestBin,
    args: cellJestArgs({ config: context.config, outputFile, testTimeoutMs: context.testTimeoutMs, tests: cell.tests }),
    env: runnerEnv({ base: context.env, inventoryFile: context.inventoryFile, traceDir, setupFile: context.setupFile, injection: { site: cell.site, mode: cell.mode } }),
    cwd: context.root,
    outputFile,
    killAfterMs: context.testTimeoutMs * (cell.tests.length + 1) + KILL_GRACE_MS,
  });
  // A suite that ran tests reports its failures per test above; only a suite that ran none has a message worth keeping.
  const suiteErrors = (run.results?.testResults ?? [])
    .filter((suite) => suite.status !== "passed" && suite.assertionResults.length === 0 && suite.message)
    .map((suite) => suite.message.slice(0, MESSAGE_CHARS));
  const diedErrors = run.results ? [] : [`runner exited with ${run.exitCode ?? run.signal} and wrote no results:\n${run.stderrTail}`];
  return {
    ran: run.results !== null,
    exitCode: run.exitCode,
    fired: firedCount({ records: readTraceRecords({ traceDir }) }),
    tests: cell.tests.map((test) => evidenceForTest({ test, results: run.results })),
    runnerErrors: [...diedErrors, ...suiteErrors],
    durationMs: run.durationMs,
  };
};
