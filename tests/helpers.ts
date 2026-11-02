import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO = path.resolve(__dirname, "..");
export const SAMPLE_API = path.join(REPO, "examples", "sample-api");
export const ESM_FIXTURE = path.join(REPO, "tests", "fixtures", "esm-service");
export const SETUP_FILE = path.join(REPO, "dist", "tracer", "setup.js");
export const CLI = path.join(REPO, "dist", "cli.js");
const JEST_BIN = path.join(REPO, "node_modules", "jest", "bin", "jest.js");

/** One test's outcome in Jest's --json output. */
export type JestAssertion = { fullName: string; status: string; failureMessages: string[] };

/** The parts of Jest's --json output the tests read. */
export type JestResults = {
  success: boolean;
  numPassedTests: number;
  numFailedTests: number;
  numRuntimeErrorTestSuites: number;
  testResults: { name: string; status: string; message: string; assertionResults: JestAssertion[] }[];
};

/**
 * Makes a fresh folder for one test's output files.
 *
 * @param params.prefix - folder name prefix
 * @returns an absolute path
 */
export const makeTempDir = ({ prefix }: { prefix: string }): string => fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));

/**
 * Runs a failwalk CLI command and returns its output.
 *
 * @param params.args - arguments after the program name
 * @param params.cwd - working folder
 * @returns exit status, stdout and stderr
 */
export const runCli = ({ args, cwd }: { args: string[]; cwd: string }): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

/**
 * Writes the sample app's inventory into a folder and returns its path.
 *
 * @param params.dir - folder to write into
 * @returns the inventory file path
 */
export const writeSampleInventory = ({ dir }: { dir: string }): string => {
  const out = path.join(dir, "failwalk-inventory.json");
  const result = runCli({ args: ["inventory", "--root", SAMPLE_API, "--wrappers", "config/**/*.js", "--out", out], cwd: dir });
  if (result.status !== 0) throw new Error(`inventory failed: ${result.stderr}`);
  return out;
};

/**
 * Runs the sample app's Jest suite, with its own config or with the failwalk override, and returns Jest's JSON results.
 *
 * @param params.env - extra environment variables, FAILWALK_* among them
 * @param params.withSetup - use jest.failwalk.config.js, which loads the tracer setup file
 * @param params.dir - folder for Jest's JSON output
 * @returns the parsed results, the raw stderr and the exit status
 */
export const runSampleJest = ({
  env = {},
  withSetup,
  dir,
}: {
  env?: Record<string, string>;
  withSetup: boolean;
  dir: string;
}): { results: JestResults; stderr: string; status: number | null } => {
  const outputFile = path.join(dir, `jest-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const config = path.join(SAMPLE_API, withSetup ? "jest.failwalk.config.js" : "jest.config.js");
  const result = spawnSync(process.execPath, [JEST_BIN, "--config", config, "--json", "--outputFile", outputFile, "--runInBand"], {
    cwd: SAMPLE_API,
    encoding: "utf8",
    env: { ...process.env, FAILWALK_SETUP: SETUP_FILE, ...env },
  });
  if (!fs.existsSync(outputFile)) throw new Error(`jest wrote no results: ${result.stderr}`);
  return { results: JSON.parse(fs.readFileSync(outputFile, "utf8")) as JestResults, stderr: result.stderr, status: result.status };
};

/**
 * Finds one test's outcome by its full name.
 *
 * @param params.results - Jest's JSON results
 * @param params.fullName - the test's full name
 * @returns the assertion result
 */
export const assertionNamed = ({ results, fullName }: { results: JestResults; fullName: string }): JestAssertion => {
  const found = results.testResults.flatMap(({ assertionResults }) => assertionResults).find((assertion) => assertion.fullName === fullName);
  if (!found) throw new Error(`no test named "${fullName}" in results`);
  return found;
};
