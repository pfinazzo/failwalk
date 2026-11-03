import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import type { TraceSummary } from "../src/tracer/mergeTraces";
import { callerFrame, parseStack, tracerDirs } from "../src/tracer/stack";
import { indexSites, reachFor } from "../src/tracer/siteIndex";
import { makeTempDir, runCli, runSampleJest, writeSampleInventory, type JestResults } from "./helpers";

const RETRIEVE = "billing.subscriptions.retrieve@controllers/subscriptions.js:12";
const UPDATE_IN_SYNC = "database.update@controllers/subscriptions.js:14";
const CANCEL = "billing.subscriptions.cancel@controllers/subscriptions.js:33";
const UPDATE_AFTER_CANCEL = "database.update@controllers/subscriptions.js:34";
const UPDATE_IN_CATCH = "database.update@controllers/subscriptions.js:37";
const UPDATE_IN_VIEW = "database.update@controllers/subscriptions.js:51";
const LIST_INVOICES = "billing.invoices.list@controllers/invoices.js:18";
const GET_IN_RECEIPT = "database.get@controllers/receipts.js:13";
const SEND_RECEIPT = "mailer.send@controllers/receipts.js:15";
const SYNC_TEST = "__tests__/subscriptions.test.js › GET /subscriptions/:id syncs the subscription from billing and returns it";
const MISSING_TEST = "__tests__/subscriptions.test.js › GET /subscriptions/:id returns 404 for a subscription billing does not know";
const CANCEL_TEST = "__tests__/subscriptions.test.js › POST /subscriptions/:id/cancel cancels at billing and reports the new status";
const VIEW_TEST = "__tests__/subscriptions.test.js › POST /subscriptions/:id/view records the view";
const MERGE_TEST = "__tests__/database.test.js › database wrapper update merges fields into a record";
const NULL_TEST = "__tests__/database.test.js › database wrapper reads a missing record as null";

/** One traced run of the sample suite, merged. Shared by the tests below. */
let traced: { results: JestResults; summary: TraceSummary; traceDir: string; inventory: string };

beforeAll(() => {
  const dir = makeTempDir({ prefix: "failwalk-trace" });
  const inventory = writeSampleInventory({ dir });
  const traceDir = path.join(dir, "trace");
  const { results } = runSampleJest({ withSetup: true, env: { FAILWALK_INVENTORY: inventory, FAILWALK_TRACE_DIR: traceDir }, dir });
  const out = path.join(dir, "failwalk-trace.json");
  const merged = runCli({ args: ["trace", "--inventory", inventory, "--trace-dir", traceDir, "--out", out], cwd: dir });
  if (merged.status !== 0) throw new Error(`trace merge failed: ${merged.stderr}`);
  traced = { results, summary: JSON.parse(fs.readFileSync(out, "utf8")) as TraceSummary, traceDir, inventory };
});

describe("the tracer (criteria 4 and 5)", () => {
  test("writes failwalk-trace.json with the call sites each test reached", () => {
    const { summary } = traced;
    expect(summary.sites[RETRIEVE]).toEqual([MISSING_TEST, SYNC_TEST]);
    expect(summary.sites[UPDATE_IN_SYNC]).toEqual([SYNC_TEST]);
    expect(summary.sites[CANCEL]).toEqual([CANCEL_TEST]);
    expect(summary.sites[UPDATE_AFTER_CANCEL]).toEqual([CANCEL_TEST]);
    expect(summary.sites[UPDATE_IN_VIEW]).toEqual([VIEW_TEST]);
    expect(summary.sites[LIST_INVOICES]).toHaveLength(2);
    const syncTest = summary.tests.find(({ name }) => name === "GET /subscriptions/:id syncs the subscription from billing and returns it");
    expect(syncTest?.sites).toEqual([RETRIEVE, UPDATE_IN_SYNC].sort());
  });

  test("lists the inventoried sites no test reached", () => {
    expect(traced.summary.unreached).toEqual([GET_IN_RECEIPT, SEND_RECEIPT, UPDATE_IN_CATCH]);
  });

  test("reports calls the inventory does not know under UNINVENTORIED with file and line", () => {
    expect(traced.summary.UNINVENTORIED).toEqual([
      { id: "UNINVENTORIED:database.get@__tests__/database.test.js:12", inventoried: false, wrapper: "database", method: "get", file: "__tests__/database.test.js", line: 12, tests: [MERGE_TEST] },
      { id: "UNINVENTORIED:database.get@__tests__/database.test.js:6", inventoried: false, wrapper: "database", method: "get", file: "__tests__/database.test.js", line: 6, tests: [NULL_TEST] },
      { id: "UNINVENTORIED:database.update@__tests__/database.test.js:10", inventoried: false, wrapper: "database", method: "update", file: "__tests__/database.test.js", line: 10, tests: [MERGE_TEST] },
      { id: "UNINVENTORIED:database.update@__tests__/database.test.js:11", inventoried: false, wrapper: "database", method: "update", file: "__tests__/database.test.js", line: 11, tests: [MERGE_TEST] },
    ]);
    const mergeTest = traced.summary.tests.find(({ name }) => name === "database wrapper update merges fields into a record");
    expect(mergeTest?.uninventoried).toHaveLength(3);
  });

  test("writes one record per test file into the trace folder", () => {
    const files = fs.readdirSync(traced.traceDir).filter((name) => name.endsWith(".json")).sort();
    expect(files).toHaveLength(9);
    expect(files.map((name) => name.replace(/-[0-9a-f]{8}\.json$/, ""))).toEqual([
      "database.test.js",
      "invoices.test.js",
      "noTimeout.test.js",
      "retryWithoutBackoff.test.js",
      "retryWithoutKey.test.js",
      "signups.test.js",
      "subscriptions.test.js",
      "swallowedCatch.test.js",
      "unawaitedCall.test.js",
    ]);
  });

  test("records no injection when FAILWALK_SITE is not set", () => {
    expect(traced.summary.injection).toBeNull();
  });

  test("the terminal summary names reached, unreached and uninventoried sites", () => {
    const dir = makeTempDir({ prefix: "failwalk-trace-print" });
    const printed = runCli({ args: ["trace", "--inventory", traced.inventory, "--trace-dir", traced.traceDir, "--out", path.join(dir, "t.json")], cwd: dir });
    expect(printed.status).toBe(0);
    expect(printed.stdout).toContain("14 tests in 9 files reached 12 of 15 call sites. 3 UNREACHED, 4 UNINVENTORIED.");
    expect(printed.stdout).toContain(`${RETRIEVE}   2 tests`);
    expect(printed.stdout).toContain(`    ${SEND_RECEIPT}`);
    expect(printed.stdout).toContain("database.get at __tests__/database.test.js:6");
  });

  test("the trace command refuses an empty trace folder instead of writing an empty summary", () => {
    const dir = makeTempDir({ prefix: "failwalk-trace-empty" });
    const printed = runCli({ args: ["trace", "--inventory", traced.inventory, "--trace-dir", path.join(dir, "nothing"), "--out", path.join(dir, "t.json")], cwd: dir });
    expect(printed.status).toBe(1);
    expect(printed.stderr).toContain("No trace records");
  });
});

describe("the setup file without an injection (criterion 7)", () => {
  test("changes no test result compared with a run without the setup file", () => {
    const dir = makeTempDir({ prefix: "failwalk-baseline" });
    const plain = runSampleJest({ withSetup: false, dir });
    const outcomes = ({ results }: { results: JestResults }) =>
      results.testResults
        .flatMap(({ assertionResults }) => assertionResults)
        .map(({ fullName, status }) => ({ fullName, status }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
    expect(plain.results.success).toBe(true);
    expect(traced.results.success).toBe(true);
    expect(outcomes({ results: traced.results })).toEqual(outcomes({ results: plain.results }));
    expect(traced.results.numPassedTests).toBe(14);
  });
});

describe("stack matching", () => {
  const wrapperFiles = new Set(["/app/config/database.js"]);
  const selfDirs = tracerDirs({ distDir: "/tool/dist/tracer" });
  const stack = [
    "Error",
    "    at captureStack (/tool/src/tracer/stack.ts:20:19)",
    "    at Object.apply (/tool/dist/tracer/wrapExports.js:44:30)",
    "    at update (/app/config/database.js:18:3)",
    "    at syncSubscription (/app/controllers/subscriptions.js:14:18)",
    "    at Object.<anonymous> (/app/__tests__/subscriptions.test.js:5:18)",
    "    at new Promise (<anonymous>)",
    "    at node:internal/process/task_queues:95:5",
    "    at run (/app/node_modules/jest-circus/build/run.js:10:1)",
  ].join("\n");

  test("the tracer's folders are dist and src beside it", () => {
    expect(selfDirs).toEqual(["/tool/dist", "/tool/src"]);
  });

  test("skips the tracer, the wrapper and dependencies and picks the product code frame", () => {
    const frames = parseStack({ stack });
    expect(frames).toHaveLength(7);
    expect(callerFrame({ frames, wrapperFiles, selfDirs })).toEqual({ file: "/app/controllers/subscriptions.js", line: 14, column: 18 });
  });

  test("matches a frame to the inventory by file and line, and falls back to UNINVENTORIED", () => {
    const index = indexSites({
      sites: [{ id: UPDATE_IN_SYNC, file: "controllers/subscriptions.js", line: 14, wrapper: "database", method: "update", kind: "write", checks: [], notes: [] }],
    });
    const hit = reachFor({ frame: { file: "/app/controllers/subscriptions.js", line: 14, column: 1 }, root: "/app", wrapper: "database", method: "update", index });
    expect(hit).toMatchObject({ id: UPDATE_IN_SYNC, inventoried: true });
    const miss = reachFor({ frame: { file: "/app/controllers/subscriptions.js", line: 99, column: 1 }, root: "/app", wrapper: "database", method: "update", index });
    expect(miss).toEqual({ id: "UNINVENTORIED:database.update@controllers/subscriptions.js:99", inventoried: false, wrapper: "database", method: "update", file: "controllers/subscriptions.js", line: 99 });
    const noFrame = reachFor({ frame: null, root: "/app", wrapper: "database", method: "update", index });
    expect(noFrame.id).toBe("UNINVENTORIED:database.update@(unknown):0");
  });

  test("on a line with two sites, the one with the same wrapper and method wins", () => {
    const index = indexSites({
      sites: [
        { id: "a.get@f.js:1", file: "f.js", line: 1, wrapper: "a", method: "get", kind: "read", checks: [], notes: [] },
        { id: "b.put@f.js:1", file: "f.js", line: 1, wrapper: "b", method: "put", kind: "write", checks: [], notes: [] },
      ],
    });
    expect(reachFor({ frame: { file: "/r/f.js", line: 1, column: 1 }, root: "/r", wrapper: "b", method: "put", index }).id).toBe("b.put@f.js:1");
    expect(reachFor({ frame: { file: "/r/f.js", line: 1, column: 1 }, root: "/r", wrapper: "c", method: "x", index }).inventoried).toBe(false);
  });
});
