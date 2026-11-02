import { describe, expect, test } from "vitest";
import { readInjection } from "../src/tracer/injection";
import { halveResult, MODE_NAMES, MODES, type DroppedError, type ModeName, type VendorError } from "../src/tracer/modes";

const CONTEXT = { wrapper: "billing", method: "subscriptions.retrieve", siteId: "x@y:1" };

/**
 * Applies a mode and returns the replacement promise it hands back.
 *
 * @param params.mode - the mode to apply
 * @returns the decision's value, typed as a promise
 */
const replacementOf = ({ mode }: { mode: ModeName }): Promise<unknown> => {
  const decision = MODES[mode].inject({ ...CONTEXT, mode });
  if (!decision.replace) throw new Error(`${mode} did not replace the call`);
  return decision.value as Promise<unknown>;
};

describe("the failure-mode table (criterion 1)", () => {
  test("has exactly the six rows, in grid order, each with a description", () => {
    expect(MODE_NAMES).toEqual(["timeout", "dropped", "500", "429", "malformed", "partial"]);
    expect(Object.keys(MODES).sort()).toEqual([...MODE_NAMES].sort());
    MODE_NAMES.forEach((mode) => expect(MODES[mode].what.length).toBeGreaterThan(10));
  });

  test("timeout never settles", async () => {
    const settled = await Promise.race([replacementOf({ mode: "timeout" }).then(() => "settled"), new Promise((resolve) => setTimeout(() => resolve("still pending"), 50))]);
    expect(settled).toBe("still pending");
  });

  test("dropped rejects with an error whose code is ECONNRESET", async () => {
    const error = (await replacementOf({ mode: "dropped" }).catch((caught: DroppedError) => caught)) as DroppedError;
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("ECONNRESET");
    expect(error.name).toBe("FailwalkInjectedError");
    expect(error.message).toContain("billing.subscriptions.retrieve");
    expect(error.failwalk).toEqual({ siteId: "x@y:1", mode: "dropped" });
  });

  test.each([
    ["500", 500],
    ["429", 429],
  ] as const)("%s rejects with a vendor-shaped error carrying status %i", async (mode, status) => {
    const error = (await replacementOf({ mode }).catch((caught: VendorError) => caught)) as VendorError;
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("FailwalkInjectedError");
    expect(error.status).toBe(status);
    expect(error.statusCode).toBe(status);
    expect(error.http_status_code).toBe(status);
    expect(error.response.status).toBe(status);
    expect(error.message).toContain(`HTTP ${status}`);
    expect(error.message).toContain("billing.subscriptions.retrieve");
    expect(error.failwalk).toEqual({ siteId: "x@y:1", mode });
  });

  test("malformed resolves with {}", async () => {
    await expect(replacementOf({ mode: "malformed" })).resolves.toEqual({});
  });

  test("partial lets the real call run, then keeps the first half of an array and turns anything else into {}", async () => {
    const decision = MODES.partial.inject({ ...CONTEXT, mode: "partial" });
    expect(decision.replace).toBe(false);
    if (decision.replace) throw new Error("partial must not replace the call");
    const transform = decision.transform as (result: unknown) => Promise<unknown>;
    await expect(transform(Promise.resolve([1, 2, 3, 4]))).resolves.toEqual([1, 2]);
    await expect(transform(Promise.resolve([1, 2, 3]))).resolves.toEqual([1]);
    await expect(transform(Promise.resolve([]))).resolves.toEqual([]);
    await expect(transform(Promise.resolve({ id: "sub_1" }))).resolves.toEqual({});
    expect(halveResult({ result: "text" })).toEqual({});
  });

  test("FAILWALK_MODE accepts every row by name", () => {
    MODE_NAMES.forEach((mode) => expect(readInjection({ env: { FAILWALK_SITE: "a@b:1", FAILWALK_MODE: mode } })).toEqual({ site: "a@b:1", mode }));
  });
});
