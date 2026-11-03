import { describe, expect, test } from "vitest";
import { kindOfMethod } from "../src/inventory/kinds";
import { scanInventory } from "../src/inventory/scan";
import { globBase, wrapperNameOf } from "../src/inventory/wrapperName";
import { ESM_FIXTURE, SAMPLE_API, makeTempDir, runCli } from "./helpers";

const RECORD_KEYS = ["id", "file", "line", "wrapper", "method", "kind", "checks", "notes"];

describe("failwalk inventory on the sample app (criteria 1 to 3)", () => {
  test("finds every wrapper call with the spec's record shape", async () => {
    const inventory = await scanInventory({ root: SAMPLE_API, wrappers: "config/**/*.js" });
    expect(inventory.wrapperFiles).toEqual(["config/billing.js", "config/database.js", "config/mailer.js"]);
    expect(inventory.errors).toEqual([]);
    expect(inventory.sites).toEqual([
      { id: "billing.invoices.list@controllers/invoices.js:18", file: "controllers/invoices.js", line: 18, wrapper: "billing", method: "invoices.list", kind: "read", checks: ["swallowed-catch", "retry-without-backoff"], notes: [] },
      { id: "mailer.send@controllers/noTimeout.js:15", file: "controllers/noTimeout.js", line: 15, wrapper: "mailer", method: "send", kind: "write", checks: ["no-timeout"], notes: [] },
      { id: "database.get@controllers/receipts.js:13", file: "controllers/receipts.js", line: 13, wrapper: "database", method: "get", kind: "read", checks: [], notes: [] },
      { id: "mailer.send@controllers/receipts.js:15", file: "controllers/receipts.js", line: 15, wrapper: "mailer", method: "send", kind: "write", checks: ["no-timeout"], notes: [] },
      { id: "billing.subscriptions.retrieve@controllers/retryWithoutBackoff.js:20", file: "controllers/retryWithoutBackoff.js", line: 20, wrapper: "billing", method: "subscriptions.retrieve", kind: "read", checks: ["retry-without-backoff"], notes: [] },
      { id: "billing.subscriptions.create@controllers/retryWithoutKey.js:25", file: "controllers/retryWithoutKey.js", line: 25, wrapper: "billing", method: "subscriptions.create", kind: "write", checks: ["retry-without-idempotency-key"], notes: [] },
      { id: "billing.subscriptions.create@controllers/signups.js:13", file: "controllers/signups.js", line: 13, wrapper: "billing", method: "subscriptions.create", kind: "write", checks: [], notes: [] },
      { id: "billing.subscriptions.retrieve@controllers/subscriptions.js:12", file: "controllers/subscriptions.js", line: 12, wrapper: "billing", method: "subscriptions.retrieve", kind: "read", checks: [], notes: [] },
      { id: "database.update@controllers/subscriptions.js:14", file: "controllers/subscriptions.js", line: 14, wrapper: "database", method: "update", kind: "write", checks: [], notes: [] },
      { id: "billing.subscriptions.cancel@controllers/subscriptions.js:33", file: "controllers/subscriptions.js", line: 33, wrapper: "billing", method: "subscriptions.cancel", kind: "write", checks: [], notes: [] },
      { id: "database.update@controllers/subscriptions.js:34", file: "controllers/subscriptions.js", line: 34, wrapper: "database", method: "update", kind: "write", checks: [], notes: [] },
      { id: "database.update@controllers/subscriptions.js:37", file: "controllers/subscriptions.js", line: 37, wrapper: "database", method: "update", kind: "write", checks: [], notes: [] },
      { id: "database.update@controllers/subscriptions.js:51", file: "controllers/subscriptions.js", line: 51, wrapper: "database", method: "update", kind: "write", checks: ["unawaited-call"], notes: [] },
      { id: "database.remove@controllers/swallowedCatch.js:16", file: "controllers/swallowedCatch.js", line: 16, wrapper: "database", method: "remove", kind: "write", checks: ["swallowed-catch"], notes: [] },
      { id: "database.update@controllers/unawaitedCall.js:14", file: "controllers/unawaitedCall.js", line: 14, wrapper: "database", method: "update", kind: "write", checks: ["unawaited-call"], notes: [] },
    ]);
  });

  test("records the full member chain for require, member chains and destructured requires", async () => {
    const { sites } = await scanInventory({ root: SAMPLE_API, wrappers: "config/**/*.js" });
    const byLine = ({ file, line }: { file: string; line: number }) => sites.find((site) => site.file === file && site.line === line);
    expect(byLine({ file: "controllers/subscriptions.js", line: 12 })?.method).toBe("subscriptions.retrieve");
    expect(byLine({ file: "controllers/subscriptions.js", line: 14 })?.method).toBe("update");
    expect(byLine({ file: "controllers/receipts.js", line: 13 })?.method).toBe("get");
    expect(byLine({ file: "controllers/invoices.js", line: 18 })?.method).toBe("invoices.list");
  });

  test("leaves test files out of the inventory", async () => {
    const { sites } = await scanInventory({ root: SAMPLE_API, wrappers: "config/**/*.js" });
    expect(sites.some(({ file }) => file.includes("__tests__") || file.includes(".test."))).toBe(false);
  });

  test("the CLI prints one JSON record per call site with exactly the eight keys, counts by wrapper, and lists each fired check (criterion 8)", () => {
    const dir = makeTempDir({ prefix: "failwalk-inventory" });
    const { status, stdout, stderr } = runCli({ args: ["inventory", "--root", SAMPLE_API, "--wrappers", "config/**/*.js", "--out", `${dir}/inv.json`], cwd: dir });
    expect(status).toBe(0);
    const records = JSON.parse(stdout) as Record<string, unknown>[];
    expect(records).toHaveLength(15);
    records.forEach((record) => expect(Object.keys(record).sort()).toEqual([...RECORD_KEYS].sort()));
    records.forEach((record) => expect(record.id).toBe(`${record.wrapper}.${record.method}@${record.file}:${record.line}`));
    expect(stderr).toContain("15 call sites in 9 files");
    expect(stderr).toMatch(/database\s+7/);
    expect(stderr).toMatch(/billing\s+6/);
    expect(stderr).toMatch(/mailer\s+2/);
    expect(stderr).toContain("9 static checks fired:");
    expect(stderr).toMatch(/^ {2}retry-without-idempotency-key {2}billing\.subscriptions\.create@controllers\/retryWithoutKey\.js:25$/m);
    expect(stderr).toMatch(/^ {2}no-timeout {21}mailer\.send@controllers\/noTimeout\.js:15$/m);
    expect(stderr).toMatch(/^ {2}swallowed-catch {16}database\.remove@controllers\/swallowedCatch\.js:16$/m);
    expect(stderr).toMatch(/^ {2}retry-without-backoff {10}billing\.subscriptions\.retrieve@controllers\/retryWithoutBackoff\.js:20$/m);
    expect(stderr).toMatch(/^ {2}unawaited-call {17}database\.update@controllers\/unawaitedCall\.js:14$/m);
    expect(stderr).not.toContain("notes:");
  });

  test("a wrapper glob that matches nothing is an error, not an empty inventory", async () => {
    await expect(scanInventory({ root: SAMPLE_API, wrappers: "nowhere/**/*.js" })).rejects.toThrow(/No wrapper modules match/);
  });
});

describe("failwalk inventory on ES module imports (criterion 2)", () => {
  test("finds calls through named, renamed, namespace and default imports, and ignores a shadowing local", async () => {
    const { sites, errors } = await scanInventory({ root: ESM_FIXTURE, wrappers: "config/*.js" });
    expect(errors).toEqual([]);
    expect(sites).toEqual([
      { id: "vendor.accounts.get@src/accounts.mjs:6", file: "src/accounts.mjs", line: 6, wrapper: "vendor", method: "accounts.get", kind: "read", checks: ["no-timeout"], notes: [] },
      { id: "vendor.ping@src/accounts.mjs:9", file: "src/accounts.mjs", line: 9, wrapper: "vendor", method: "ping", kind: "write", checks: ["no-timeout"], notes: [] },
      { id: "vendor.accounts.close@src/accounts.mjs:12", file: "src/accounts.mjs", line: 12, wrapper: "vendor", method: "accounts.close", kind: "write", checks: ["no-timeout"], notes: [] },
      { id: "queue.jobs.enqueue@src/accounts.mjs:15", file: "src/accounts.mjs", line: 15, wrapper: "queue", method: "jobs.enqueue", kind: "write", checks: ["no-timeout"], notes: [] },
    ]);
  });
});

describe("kind lookup (criterion 3)", () => {
  test.each(["get", "retrieve", "list", "find", "fetch", "query", "exists"])("%s is a read", (verb) => {
    expect(kindOfMethod({ method: `things.${verb}` })).toBe("read");
  });

  test("a read verb as a prefix with a capital after it is a read", () => {
    expect(kindOfMethod({ method: "getUser" })).toBe("read");
    expect(kindOfMethod({ method: "auth.listUsers" })).toBe("read");
  });

  test("anything else is a write, including names that only contain or start with a read verb", () => {
    expect(kindOfMethod({ method: "subscriptions.create" })).toBe("write");
    expect(kindOfMethod({ method: "update" })).toBe("write");
    expect(kindOfMethod({ method: "charge" })).toBe("write");
    expect(kindOfMethod({ method: "target" })).toBe("write");
    expect(kindOfMethod({ method: "forget" })).toBe("write");
    expect(kindOfMethod({ method: "getaway" })).toBe("write");
  });
});

describe("wrapper names", () => {
  test("come from the path under the wrapper folder", () => {
    expect(globBase({ pattern: "config/**/*.js" })).toBe("config");
    expect(globBase({ pattern: "src/lib/vendors/*.ts" })).toBe("src/lib/vendors");
    expect(globBase({ pattern: "config/billing.js" })).toBe("config");
    expect(globBase({ pattern: "*.js" })).toBe("");
    expect(wrapperNameOf({ file: "config/billing.js", wrapperBase: "config" })).toBe("billing");
    expect(wrapperNameOf({ file: "config/database/index.js", wrapperBase: "config" })).toBe("database");
    expect(wrapperNameOf({ file: "config/database/queries.js", wrapperBase: "config" })).toBe("database/queries");
  });
});
