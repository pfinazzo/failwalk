import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Injection } from "./injection";
import type { TraceState } from "./recorder";
import type { Reach } from "./siteIndex";

/** One test's reaches as written to disk. */
export type TestRecord = { testPath: string | null; name: string; sites: string[]; uninventoried: Reach[] };

/** What one test file (or one worker process, under `setupFiles`) writes when it finishes. */
export type TraceRecord = {
  testPath: string | null;
  tests: TestRecord[];
  injection: (Injection & { fired: number }) | null;
};

/**
 * Turns the tracer's state into the record written to disk. Pure.
 *
 * @param params.state - the tracer's state
 * @param params.testPath - the test file, or null when unknown
 * @param params.injection - the active injection, or null
 * @returns the record
 */
export const toTraceRecord = ({
  state,
  testPath,
  injection,
}: {
  state: TraceState;
  testPath: string | null;
  injection: Injection | null;
}): TraceRecord => ({
  testPath,
  tests: [...state.tests.values()].map((test) => {
    const reaches = [...test.reaches.values()];
    return {
      testPath: test.testPath,
      name: test.name,
      sites: reaches.filter((reach) => reach.inventoried).map((reach) => reach.id).sort(),
      uninventoried: reaches.filter((reach) => !reach.inventoried),
    };
  }),
  injection: injection ? { ...injection, fired: state.injectionFired } : null,
});

/**
 * Names the trace file for a test file: its base name plus a short hash of the full path, so two `index.test.js` never collide.
 *
 * @param params.testPath - the test file, or null for a process-wide record
 * @returns a file name ending in .json
 */
export const traceFileName = ({ testPath }: { testPath: string | null }): string => {
  const key = testPath ?? `process-${process.pid}`;
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 8);
  return `${path.basename(key).replace(/[^A-Za-z0-9._-]/g, "_")}-${hash}.json`;
};

/**
 * Writes one trace record into the trace folder. Creates the folder when missing.
 *
 * @param params.traceDir - absolute folder for per-file records
 * @param params.record - the record to write
 * @returns the path written
 */
export const writeTraceRecord = ({ traceDir, record }: { traceDir: string; record: TraceRecord }): string => {
  fs.mkdirSync(traceDir, { recursive: true });
  const file = path.join(traceDir, traceFileName({ testPath: record.testPath }));
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return file;
};

/**
 * Reads every trace record in the folder. An empty or missing folder gives an empty list.
 *
 * @param params.traceDir - absolute folder for per-file records
 * @returns the records
 */
export const readTraceRecords = ({ traceDir }: { traceDir: string }): TraceRecord[] => {
  if (!fs.existsSync(traceDir)) return [];
  return fs
    .readdirSync(traceDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(traceDir, name), "utf8")) as TraceRecord);
};
