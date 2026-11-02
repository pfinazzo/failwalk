import type { Reach } from "./siteIndex";

/** Everything one test reached, keyed by reach id. */
export type TestReaches = { testPath: string | null; name: string; reaches: Map<string, Reach> };

/** The tracer's record for the current test file. */
export type TraceState = { tests: Map<string, TestReaches>; injectionFired: number };

/**
 * The one piece of state the tracer keeps. It is a module singleton on purpose: wrapped methods
 * have no other way to hand their reaches to the hook that writes the trace file.
 */
export const traceState: TraceState = { tests: new Map(), injectionFired: 0 };

/**
 * Records that a test reached a wrapper call. Writes to traceState.
 *
 * @param params.testPath - the test file, or null when unknown
 * @param params.name - the test's full name
 * @param params.reach - the call that was reached
 */
export const recordReach = ({ testPath, name, reach }: { testPath: string | null; name: string; reach: Reach }): void => {
  const key = `${testPath ?? ""}\n${name}`;
  const existing = traceState.tests.get(key) ?? { testPath, name, reaches: new Map<string, Reach>() };
  existing.reaches.set(reach.id, reach);
  traceState.tests.set(key, existing);
};

/**
 * Counts one more injected call. Writes to traceState.
 */
export const recordInjectionFired = (): void => {
  traceState.injectionFired += 1;
};
