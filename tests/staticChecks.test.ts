import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { scanInventory } from "../src/inventory/scan";
import { CHECK_NAMES, STATIC_CHECKS } from "../src/inventory/staticChecks";
import type { CallSite } from "../src/inventory/types";
import { wrapperTimeoutsOf, hasTimeout } from "../src/inventory/wrapperTimeouts";
import { REPO } from "./helpers";

const FIXTURE = path.join(REPO, "tests", "fixtures", "static-checks");
const CASES_FILE = path.join(FIXTURE, "src", "cases.js");

/** The inventory of the fixture, keyed by the `// case:` marker on each call's line. Shared by the tests below. */
let siteByCase: Record<string, CallSite>;

/**
 * Reads the line number of every `// case: <name>` marker in the cases file.
 *
 * @returns marker name to 1-based line
 */
const markerLines = (): Record<string, number> =>
  fs
    .readFileSync(CASES_FILE, "utf8")
    .split("\n")
    .reduce<Record<string, number>>((acc, line, index) => {
      const match = /\/\/ case: ([a-z-]+)$/.exec(line);
      return match ? { ...acc, [match[1]]: index + 1 } : acc;
    }, {});

beforeAll(async () => {
  const inventory = await scanInventory({ root: FIXTURE, wrappers: "config/*.js" });
  if (inventory.errors.length > 0) throw new Error(`fixture did not parse: ${JSON.stringify(inventory.errors)}`);
  const byLine = inventory.sites.reduce<Record<number, CallSite>>((acc, site) => ({ ...acc, [site.line]: site }), {});
  siteByCase = Object.entries(markerLines()).reduce<Record<string, CallSite>>((acc, [name, line]) => {
    const site = byLine[line];
    if (!site) throw new Error(`no call site on line ${line} for case ${name}`);
    return { ...acc, [name]: site };
  }, {});
});

/**
 * The checks that fired for one marked case.
 *
 * @param params.name - the marker name
 * @returns the check names
 */
const checksOf = ({ name }: { name: string }): string[] => siteByCase[name].checks;

describe("the check table (criterion 1)", () => {
  test("has exactly the five rows, in spec order, each with a sentence and a function", () => {
    expect(CHECK_NAMES).toEqual(["retry-without-idempotency-key", "no-timeout", "swallowed-catch", "retry-without-backoff", "unawaited-call"]);
    expect(Object.keys(STATIC_CHECKS).sort()).toEqual([...CHECK_NAMES].sort());
    CHECK_NAMES.forEach((name) => {
      expect(STATIC_CHECKS[name].what.length).toBeGreaterThan(20);
      expect(typeof STATIC_CHECKS[name].fires).toBe("function");
    });
  });

  test("every fixture site carries checks and notes arrays, and the marked cases are all there", () => {
    expect(Object.keys(siteByCase)).toHaveLength(36);
    Object.values(siteByCase).forEach((site) => {
      expect(Array.isArray(site.checks)).toBe(true);
      expect(Array.isArray(site.notes)).toBe(true);
    });
  });
});

describe("retry-without-idempotency-key (criteria 2 and 3)", () => {
  test("fires on a write inside a loop with try/catch, and inside a retry helper's callback", () => {
    expect(checksOf({ name: "key-fires-loop" })).toEqual(["retry-without-idempotency-key"]);
    expect(checksOf({ name: "key-fires-helper" })).toContain("retry-without-idempotency-key");
  });

  test("stays quiet with a key property, with an Idempotency-Key header, on a read, outside a retry, and in a loop without a catch", () => {
    expect(checksOf({ name: "key-quiet-key" })).toEqual([]);
    expect(checksOf({ name: "key-quiet-header" })).toEqual([]);
    expect(checksOf({ name: "key-quiet-read" })).toEqual([]);
    expect(checksOf({ name: "key-quiet-no-retry" })).toEqual([]);
    expect(checksOf({ name: "key-quiet-loop-no-catch" })).toEqual([]);
  });
});

describe("no-timeout (criterion 4)", () => {
  test("fires when neither the call nor the wrapper's method names a timeout", () => {
    expect(checksOf({ name: "timeout-fires" })).toEqual(["no-timeout"]);
  });

  test("stays quiet with a timeout in the call, in the method's own definition, or at the wrapper's module level", () => {
    expect(checksOf({ name: "timeout-quiet-call" })).toEqual([]);
    expect(checksOf({ name: "timeout-quiet-method" })).toEqual([]);
    expect(checksOf({ name: "timeout-quiet-module" })).toEqual([]);
  });

  test("reads a wrapper module for timeout identifiers at module level and per method", () => {
    const vendor = wrapperTimeoutsOf({ code: fs.readFileSync(path.join(FIXTURE, "config", "vendor.js"), "utf8"), file: "vendor.js" });
    expect(vendor).toEqual({ moduleLevel: false, methods: ["charge"] });
    const store = wrapperTimeoutsOf({ code: fs.readFileSync(path.join(FIXTURE, "config", "store.js"), "utf8"), file: "store.js" });
    expect(store).toEqual({ moduleLevel: true, methods: [] });
    expect(hasTimeout({ timeouts: vendor, method: "charge" })).toBe(true);
    expect(hasTimeout({ timeouts: vendor, method: "payments.charge" })).toBe(true);
    expect(hasTimeout({ timeouts: vendor, method: "ping" })).toBe(false);
    expect(hasTimeout({ timeouts: store, method: "anything" })).toBe(true);
  });
});

describe("swallowed-catch (criterion 5)", () => {
  test("fires when the catch only logs, or returns nothing", () => {
    expect(checksOf({ name: "swallow-fires" })).toEqual(["swallowed-catch"]);
    expect(checksOf({ name: "swallow-fires-bare-return" })).toEqual(["swallowed-catch"]);
  });

  test("stays quiet when the catch throws, returns a value or rejects, when the call is in the catch itself, and under try/finally", () => {
    expect(checksOf({ name: "swallow-quiet-throw" })).toEqual([]);
    expect(checksOf({ name: "swallow-quiet-return" })).toEqual([]);
    expect(checksOf({ name: "swallow-quiet-reject" })).toEqual([]);
    expect(checksOf({ name: "swallow-quiet-in-catch" })).toEqual([]);
    expect(checksOf({ name: "swallow-quiet-finally" })).toEqual([]);
  });
});

describe("retry-without-backoff (criterion 6)", () => {
  test("fires on a loop and on a helper callback with no wait between attempts", () => {
    expect(checksOf({ name: "backoff-fires-loop" })).toEqual(["retry-without-backoff"]);
    expect(checksOf({ name: "backoff-fires-helper" })).toEqual(["retry-without-backoff"]);
  });

  test("stays quiet with an awaited sleep, an awaited setTimeout promise, an awaited delay in the callback, and outside a retry", () => {
    expect(checksOf({ name: "backoff-quiet-sleep" })).toEqual([]);
    expect(checksOf({ name: "backoff-quiet-set-timeout" })).toEqual([]);
    expect(checksOf({ name: "backoff-quiet-delay-helper" })).toEqual([]);
    expect(checksOf({ name: "backoff-quiet-no-retry" })).toEqual([]);
  });
});

describe("unawaited-call (criterion 7)", () => {
  test("fires on a bare call, a void call, and a call behind &&", () => {
    expect(checksOf({ name: "unawaited-fires" })).toEqual(["unawaited-call"]);
    expect(checksOf({ name: "unawaited-fires-void" })).toEqual(["unawaited-call"]);
    expect(checksOf({ name: "unawaited-fires-logical" })).toEqual(["unawaited-call"]);
  });

  test("stays quiet when the call is awaited, returned, an arrow body, assigned, an argument, or followed by .then or .catch", () => {
    ["unawaited-quiet-await", "unawaited-quiet-return", "unawaited-quiet-arrow", "unawaited-quiet-assigned", "unawaited-quiet-argument", "unawaited-quiet-then", "unawaited-quiet-catch"].forEach(
      (name) => expect(checksOf({ name })).toEqual([]),
    );
  });
});

describe("the retry-shape-unknown note (criterion 2)", () => {
  test("is recorded for a site whose function calls itself from a catch, and nowhere else", () => {
    expect(siteByCase["note-recursive"].notes).toEqual(["retry-shape-unknown"]);
    expect(siteByCase["note-recursive"].checks).toEqual([]);
    expect(siteByCase["note-quiet-other"].notes).toEqual([]);
    Object.entries(siteByCase)
      .filter(([name]) => name !== "note-recursive")
      .forEach(([, site]) => expect(site.notes).toEqual([]));
  });
});
