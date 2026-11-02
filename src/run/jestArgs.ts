import type { PlannedTest } from "../plan/buildPlan";
import type { ModeName } from "../tracer/modes";

/** The variables the setup file reads, plus the ones the project's config override may read. */
export type RunnerEnv = Record<string, string | undefined>;

/**
 * Escapes a string so a regular expression matches it literally.
 *
 * @param params.text - the literal text
 * @returns the escaped pattern
 */
export const escapeRegex = ({ text }: { text: string }): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Builds the runner arguments shared by the baseline and every cell: the config override, JSON results, and a per-test timeout failwalk sets itself.
 * `--forceExit` ends the process once results are written, so a request left hanging by a `timeout` injection cannot keep it alive.
 *
 * @param params.config - the project's config override that loads the setup file
 * @param params.outputFile - where the runner writes its JSON results
 * @param params.testTimeoutMs - the per-test timeout, in milliseconds
 * @returns runner arguments
 */
export const baseJestArgs = ({ config, outputFile, testTimeoutMs }: { config: string; outputFile: string; testTimeoutMs: number }): string[] => [
  "--config",
  config,
  "--json",
  "--outputFile",
  outputFile,
  "--testTimeout",
  String(testTimeoutMs),
  "--forceExit",
];

/**
 * Builds the runner arguments for one cell: the base arguments plus filters to exactly the planned tests, by file and by full name, run in band.
 *
 * @param params.config - the project's config override
 * @param params.outputFile - where the runner writes its JSON results
 * @param params.testTimeoutMs - the per-test timeout, in milliseconds
 * @param params.tests - the cell's planned tests
 * @returns runner arguments
 */
export const cellJestArgs = ({
  config,
  outputFile,
  testTimeoutMs,
  tests,
}: {
  config: string;
  outputFile: string;
  testTimeoutMs: number;
  tests: readonly PlannedTest[];
}): string[] => {
  const files = [...new Set(tests.map(({ testPath }) => testPath))].map((file) => `^${escapeRegex({ text: file })}$`);
  const names = [...new Set(tests.map(({ name }) => escapeRegex({ text: name })))];
  return [
    ...baseJestArgs({ config, outputFile, testTimeoutMs }),
    "--runInBand",
    "--testPathPatterns",
    ...files,
    "--testNamePattern",
    `^(${names.join("|")})$`,
  ];
};

/**
 * Builds the environment for one runner process. Pure: returns a new object, with the injection variables set for a cell
 * and removed for the baseline, so a stale pair in the parent shell can never leak into a run.
 *
 * @param params.base - the parent environment, usually process.env
 * @param params.inventoryFile - the inventory the setup file matches against
 * @param params.traceDir - where this run's trace records go
 * @param params.setupFile - the built setup file, for config overrides that read FAILWALK_SETUP
 * @param params.injection - the cell's site and mode, or null for the baseline
 * @returns the child environment
 */
export const runnerEnv = ({
  base,
  inventoryFile,
  traceDir,
  setupFile,
  injection,
}: {
  base: RunnerEnv;
  inventoryFile: string;
  traceDir: string;
  setupFile: string;
  injection: { site: string; mode: ModeName } | null;
}): RunnerEnv => {
  const { FAILWALK_SITE: _site, FAILWALK_MODE: _mode, ...rest } = base;
  const injected = injection ? { FAILWALK_SITE: injection.site, FAILWALK_MODE: injection.mode } : {};
  return { ...rest, FAILWALK_INVENTORY: inventoryFile, FAILWALK_TRACE_DIR: traceDir, FAILWALK_SETUP: setupFile, ...injected };
};
