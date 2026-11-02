/** Where a test name comes from, and when the trace is flushed, depending on which Jest globals exist. */

/** Name used for wrapper calls made outside any test, in a `beforeAll` for example. */
export const OUTSIDE_TEST = "(outside any test)";

/** Name used when the setup file was loaded through `setupFiles`, before Jest installs `expect`. */
export const UNKNOWN_TEST = "(test name unavailable: load the setup file through setupFilesAfterEnv)";

/** The test running right now. */
export type CurrentTest = { testPath: string | null; name: string };

/**
 * Says whether Jest's test framework globals are installed, which is true under `setupFilesAfterEnv` and false under `setupFiles`.
 *
 * @returns true when `expect` and `afterAll` exist
 */
const hasTestFramework = (): boolean => typeof expect !== "undefined" && typeof afterAll === "function";

/**
 * Reads the current test's path and full name from Jest.
 *
 * @returns the current test, with placeholder names when Jest cannot say
 */
export const currentTest = (): CurrentTest => {
  if (!hasTestFramework()) return { testPath: null, name: UNKNOWN_TEST };
  const state = expect.getState();
  return { testPath: state.testPath ?? null, name: state.currentTestName ?? OUTSIDE_TEST };
};

/**
 * Runs `flush` when the test file ends. Under `setupFiles` there is no `afterAll`, so it runs when the worker exits instead.
 *
 * @param params.flush - writes the trace record
 */
export const onSuiteEnd = ({ flush }: { flush: () => void }): void => {
  if (hasTestFramework()) {
    afterAll(flush);
    return;
  }
  process.on("exit", flush);
};
