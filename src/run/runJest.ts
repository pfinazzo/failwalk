import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { RunnerEnv } from "./jestArgs";

/** One test's outcome in the runner's JSON results. */
export type JestAssertion = { fullName: string; status: string; failureMessages: string[] };

/** One test file's outcome in the runner's JSON results. */
export type JestSuite = { name: string; status: string; message: string; assertionResults: JestAssertion[] };

/** The parts of the runner's JSON results failwalk reads. */
export type JestJson = {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numRuntimeErrorTestSuites: number;
  testResults: JestSuite[];
};

/** What one runner process did. `results` is null when it wrote no JSON file. */
export type JestRun = {
  exitCode: number | null;
  signal: string | null;
  killed: boolean;
  results: JestJson | null;
  stderrTail: string;
  durationMs: number;
};

/** How much of the runner's stderr to keep, from the end. Enough for the summary and the last error. */
const STDERR_TAIL_CHARS = 4000;

/** The built setup file next to this module's folder, for config overrides that read FAILWALK_SETUP. */
export const SETUP_FILE = path.join(__dirname, "..", "tracer", "setup.js");

/**
 * Finds the runner's executable script, resolved from the project so the project's own copy runs.
 * Throws when the project has none, naming the folder, because a missing runner is a setup problem and not an empty run.
 *
 * @param params.root - the project folder
 * @returns absolute path of the runner script
 */
export const resolveJestBin = ({ root }: { root: string }): string => {
  try {
    return require.resolve("jest/bin/jest", { paths: [root] });
  } catch (error) {
    throw new Error(`failwalk: no test runner found from ${root}. Install jest in the project first.`, { cause: error });
  }
};

/**
 * Runs one runner process to completion and reads its JSON results. Never throws for a failing suite: that is the evidence.
 * Kills the process after `killAfterMs`, which only happens when the runner itself stalls past every per-test timeout.
 *
 * @param params.jestBin - the runner script
 * @param params.args - runner arguments
 * @param params.env - the child environment
 * @param params.cwd - the folder to run in, usually the project root
 * @param params.outputFile - where the arguments told the runner to write its JSON
 * @param params.killAfterMs - deadline for the whole process
 * @returns what the process did
 */
export const runJest = ({
  jestBin,
  args,
  env,
  cwd,
  outputFile,
  killAfterMs,
}: {
  jestBin: string;
  args: readonly string[];
  env: RunnerEnv;
  cwd: string;
  outputFile: string;
  killAfterMs: number;
}): Promise<JestRun> =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [jestBin, ...args], { cwd, env, stdio: ["ignore", "ignore", "pipe"], timeout: killAfterMs });
    // The runner's stderr, kept to the tail. Appended by the stream, read once at exit.
    const stderr = { text: "" };
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.text = (stderr.text + chunk.toString("utf8")).slice(-STDERR_TAIL_CHARS);
    });
    child.on("close", (exitCode, signal) => {
      const results = fs.existsSync(outputFile) ? (JSON.parse(fs.readFileSync(outputFile, "utf8")) as JestJson) : null;
      resolve({ exitCode, signal, killed: child.killed, results, stderrTail: stderr.text, durationMs: Date.now() - startedAt });
    });
  });
