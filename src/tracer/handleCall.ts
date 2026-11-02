import type { Injection } from "./injection";
import { MODES } from "./modes";
import { recordInjectionFired, recordReach } from "./recorder";
import { reachFor, type SiteIndex } from "./siteIndex";
import { callerFrame, captureStack, parseStack } from "./stack";
import type { CallDecision } from "./wrapExports";
import type { CurrentTest } from "./jestHooks";

/**
 * Handles one wrapper call: finds the call site from the stack, records the reach for the current test,
 * and swaps in the failure mode when the site is the injection target. Writes to the tracer state.
 * Must run synchronously inside the wrapped method so the stack still holds the caller.
 *
 * @param params.wrapper - wrapper name
 * @param params.method - method chain that was called
 * @param params.root - inventory root
 * @param params.wrapperFiles - absolute paths of the wrapper modules
 * @param params.selfDirs - the tracer's own folders, skipped when reading the stack
 * @param params.index - inventory sites by file and line
 * @param params.injection - the active injection, or null
 * @param params.test - the test running right now
 * @returns proceed, or the replacement value for the injected site
 */
export const handleCall = ({
  wrapper,
  method,
  root,
  wrapperFiles,
  selfDirs,
  index,
  injection,
  test,
}: {
  wrapper: string;
  method: string;
  root: string;
  wrapperFiles: ReadonlySet<string>;
  selfDirs: readonly string[];
  index: SiteIndex;
  injection: Injection | null;
  test: CurrentTest;
}): CallDecision => {
  const frame = callerFrame({ frames: parseStack({ stack: captureStack() }), wrapperFiles, selfDirs });
  const reach = reachFor({ frame, root, wrapper, method, index });
  recordReach({ testPath: test.testPath, name: test.name, reach });
  if (!injection || injection.site !== reach.id) return { replace: false };
  recordInjectionFired();
  return { replace: true, value: MODES[injection.mode]({ wrapper, method, siteId: reach.id, mode: injection.mode }) };
};
