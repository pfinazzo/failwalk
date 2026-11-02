import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { readInjection } from "../src/tracer/injection";
import { MODES, type VendorError } from "../src/tracer/modes";
import type { TraceRecord } from "../src/tracer/traceFile";
import { wrapExports } from "../src/tracer/wrapExports";
import { assertionNamed, makeTempDir, runSampleJest, writeSampleInventory } from "./helpers";

const UPDATE_IN_SYNC = "database.update@controllers/subscriptions.js:14";
const CANCEL = "billing.subscriptions.cancel@controllers/subscriptions.js:33";
const UPDATE_IN_VIEW = "database.update@controllers/subscriptions.js:51";
const LIST_INVOICES = "billing.invoices.list@controllers/invoices.js:18";
const SYNC_TEST = "GET /subscriptions/:id syncs the subscription from billing and returns it";
const MISSING_TEST = "GET /subscriptions/:id returns 404 for a subscription billing does not know";
const CANCEL_TEST = "POST /subscriptions/:id/cancel cancels at billing and reports the new status";
const VIEW_TEST = "POST /subscriptions/:id/view records the view";
const LIST_TEST = "GET /customers/:id/invoices lists the customer's invoices";
const EMPTY_LIST_TEST = "GET /customers/:id/invoices returns an empty list for a customer with no invoices";
const MERGE_TEST = "database wrapper update merges fields into a record";

/**
 * Runs the sample suite with one site injected and returns Jest's results plus the trace records.
 *
 * @param params.site - inventory id to inject
 * @returns results, stderr and records
 */
const runInjected = ({ site }: { site: string }) => {
  const dir = makeTempDir({ prefix: "failwalk-inject" });
  const inventory = writeSampleInventory({ dir });
  const traceDir = path.join(dir, "trace");
  const run = runSampleJest({
    withSetup: true,
    env: { FAILWALK_INVENTORY: inventory, FAILWALK_TRACE_DIR: traceDir, FAILWALK_SITE: site, FAILWALK_MODE: "500" },
    dir,
  });
  const records = fs.readdirSync(traceDir).map((name) => JSON.parse(fs.readFileSync(path.join(traceDir, name), "utf8")) as TraceRecord);
  const fired = records.reduce((sum, record) => sum + (record.injection?.fired ?? 0), 0);
  return { ...run, records, fired };
};

describe("FAILWALK_SITE with FAILWALK_MODE=500 (criterion 6)", () => {
  test("rejects exactly the targeted call site with a vendor-shaped 500 and leaves every other call real", () => {
    const { results, records, fired } = runInjected({ site: UPDATE_IN_SYNC });
    const sync = assertionNamed({ results, fullName: SYNC_TEST });
    expect(sync.status).toBe("failed");
    const message = sync.failureMessages.join("\n");
    // The route turns the injected error into a 500 response, so the test sees the status, not the message.
    expect(message).toContain("Expected: 200");
    expect(message).toContain("Received: 500");
    // The same wrapper method, database.update, called from other lines keeps working.
    expect(assertionNamed({ results, fullName: CANCEL_TEST }).status).toBe("passed");
    expect(assertionNamed({ results, fullName: VIEW_TEST }).status).toBe("passed");
    expect(assertionNamed({ results, fullName: MERGE_TEST }).status).toBe("passed");
    // The 404 test runs the same function but returns before line 14, so it is not injected.
    expect(assertionNamed({ results, fullName: MISSING_TEST }).status).toBe("passed");
    expect(results.numFailedTests).toBe(1);
    expect(fired).toBe(1);
    expect(records.every((record) => record.injection?.site === UPDATE_IN_SYNC && record.injection.mode === "500")).toBe(true);
  });

  test("a floating promise at the injected site surfaces as a crash: the injected error itself fails the test", () => {
    const { results, fired } = runInjected({ site: UPDATE_IN_VIEW });
    const view = assertionNamed({ results, fullName: VIEW_TEST });
    expect(view.status).toBe("failed");
    expect(view.failureMessages[0]).toMatch(/^FailwalkInjectedError: database\.update failed with HTTP 500/);
    expect(view.failureMessages[0]).not.toContain("expect(");
    expect(results.numFailedTests).toBe(1);
    expect(fired).toBe(1);
  });

  test("a call inside try/catch turns the injection into a different response, which the test catches", () => {
    const { results, fired } = runInjected({ site: CANCEL });
    const cancel = assertionNamed({ results, fullName: CANCEL_TEST });
    expect(cancel.status).toBe("failed");
    expect(cancel.failureMessages.join("\n")).toContain("Received: 202");
    expect(results.numFailedTests).toBe(1);
    expect(fired).toBe(1);
  });

  test("a call inside a retry loop is injected on every attempt", () => {
    const { results, fired } = runInjected({ site: LIST_INVOICES });
    expect(assertionNamed({ results, fullName: LIST_TEST }).status).toBe("failed");
    expect(assertionNamed({ results, fullName: EMPTY_LIST_TEST }).status).toBe("failed");
    expect(assertionNamed({ results, fullName: LIST_TEST }).failureMessages.join("\n")).toContain("Received: 502");
    expect(fired).toBe(6);
  });
});

describe("the 500 mode", () => {
  test("rejects with an error that has status 500 and names the wrapper", async () => {
    const result = MODES["500"]({ wrapper: "billing", method: "subscriptions.retrieve", siteId: "x@y:1", mode: "500" }) as Promise<never>;
    const error = (await result.catch((caught: VendorError) => caught)) as VendorError;
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("FailwalkInjectedError");
    expect(error.status).toBe(500);
    expect(error.statusCode).toBe(500);
    expect(error.http_status_code).toBe(500);
    expect(error.response.status).toBe(500);
    expect(error.message).toContain("billing.subscriptions.retrieve");
    expect(error.message).toContain("HTTP 500");
    expect(error.failwalk).toEqual({ siteId: "x@y:1", mode: "500" });
  });
});

describe("reading the injection from the environment", () => {
  test("returns null when neither variable is set", () => {
    expect(readInjection({ env: {} })).toBeNull();
  });

  test("returns the pair when both are set", () => {
    expect(readInjection({ env: { FAILWALK_SITE: "a@b:1", FAILWALK_MODE: "500" } })).toEqual({ site: "a@b:1", mode: "500" });
  });

  test("throws on half a pair or an unknown mode", () => {
    expect(() => readInjection({ env: { FAILWALK_SITE: "a@b:1" } })).toThrow(/set together/);
    expect(() => readInjection({ env: { FAILWALK_MODE: "500" } })).toThrow(/set together/);
    expect(() => readInjection({ env: { FAILWALK_SITE: "a@b:1", FAILWALK_MODE: "timeout" } })).toThrow(/Unknown FAILWALK_MODE "timeout"/);
  });
});

describe("wrapping exports", () => {
  test("reports the member chain, calls the real function with the real this, and can replace a result", () => {
    const calls: string[] = [];
    const real = {
      database: {
        secret: 7,
        update({ value }: { value: number }) {
          return this.secret + value;
        },
      },
      ping: () => "pong",
    };
    const wrapped = wrapExports({
      value: real,
      onCall: ({ method }) => {
        calls.push(method);
        return method === "ping" ? { replace: true, value: "replaced" } : { replace: false };
      },
    }) as typeof real;
    expect(wrapped.database.update({ value: 1 })).toBe(8);
    expect(wrapped.ping()).toBe("replaced");
    expect(wrapped.database).toBe(wrapped.database);
    expect(wrapped.database.secret).toBe(7);
    expect(calls).toEqual(["database.update", "ping"]);
    expect(real.ping()).toBe("pong");
  });

  test("a module that exports one function reports it as default", () => {
    const calls: string[] = [];
    const wrapped = wrapExports({ value: () => 1, onCall: ({ method }) => (calls.push(method), { replace: false }) }) as () => number;
    expect(wrapped()).toBe(1);
    expect(calls).toEqual(["default"]);
  });

  test("leaves a frozen property alone instead of throwing", () => {
    const real = Object.freeze({ fixed: () => 1 });
    const wrapped = wrapExports({ value: real, onCall: () => ({ replace: false }) }) as typeof real;
    expect(wrapped.fixed()).toBe(1);
  });
});
