import { describe, expect, test } from "vitest";
import { kindOfMethod } from "../src/inventory/kinds";
import { scanInventory } from "../src/inventory/scan";
import { globBase, wrapperNameOf } from "../src/inventory/wrapperName";
import { ESM_FIXTURE, SAMPLE_API, makeTempDir, runCli } from "./helpers";

const RECORD_KEYS = ["id", "file", "line", "wrapper", "method", "kind"];

describe("failwalk inventory on the sample app (criteria 1 to 3)", () => {
  test("finds every wrapper call with the spec's record shape", async () => {
    const inventory = await scanInventory({ root: SAMPLE_API, wrappers: "config/**/*.js" });
    expect(inventory.wrapperFiles).toEqual(["config/billing.js", "config/database.js", "config/mailer.js"]);
    expect(inventory.errors).toEqual([]);
    expect(inventory.sites).toEqual([
      { id: "billing.invoices.list@controllers/invoices.js:18", file: "controllers/invoices.js", line: 18, wrapper: "billing", method: "invoices.list", kind: "read" },
      { id: "database.get@controllers/receipts.js:13", file: "controllers/receipts.js", line: 13, wrapper: "database", method: "get", kind: "read" },
      { id: "mailer.send@controllers/receipts.js:15", file: "controllers/receipts.js", line: 15, wrapper: "mailer", method: "send", kind: "write" },
      { id: "billing.subscriptions.retrieve@controllers/subscriptions.js:12", file: "controllers/subscriptions.js", line: 12, wrapper: "billing", method: "subscriptions.retrieve", kind: "read" },
      { id: "database.update@controllers/subscriptions.js:14", file: "controllers/subscriptions.js", line: 14, wrapper: "database", method: "update", kind: "write" },
      { id: "billing.subscriptions.cancel@controllers/subscriptions.js:33", file: "controllers/subscriptions.js", line: 33, wrapper: "billing", method: "subscriptions.cancel", kind: "write" },
      { id: "database.update@controllers/subscriptions.js:34", file: "controllers/subscriptions.js", line: 34, wrapper: "database", method: "update", kind: "write" },
      { id: "database.update@controllers/subscriptions.js:37", file: "controllers/subscriptions.js", line: 37, wrapper: "database", method: "update", kind: "write" },
      { id: "database.update@controllers/subscriptions.js:51", file: "controllers/subscriptions.js", line: 51, wrapper: "database", method: "update", kind: "write" },
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

  test("the CLI prints one JSON record per call site with exactly the six keys, and counts by wrapper", () => {
    const dir = makeTempDir({ prefix: "failwalk-inventory" });
    const { status, stdout, stderr } = runCli({ args: ["inventory", "--root", SAMPLE_API, "--wrappers", "config/**/*.js", "--out", `${dir}/inv.json`], cwd: dir });
    expect(status).toBe(0);
    const records = JSON.parse(stdout) as Record<string, unknown>[];
    expect(records).toHaveLength(9);
    records.forEach((record) => expect(Object.keys(record).sort()).toEqual([...RECORD_KEYS].sort()));
    records.forEach((record) => expect(record.id).toBe(`${record.wrapper}.${record.method}@${record.file}:${record.line}`));
    expect(stderr).toContain("9 call sites in 3 files");
    expect(stderr).toMatch(/database\s+5/);
    expect(stderr).toMatch(/billing\s+3/);
    expect(stderr).toMatch(/mailer\s+1/);
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
      { id: "vendor.accounts.get@src/accounts.mjs:6", file: "src/accounts.mjs", line: 6, wrapper: "vendor", method: "accounts.get", kind: "read" },
      { id: "vendor.ping@src/accounts.mjs:9", file: "src/accounts.mjs", line: 9, wrapper: "vendor", method: "ping", kind: "write" },
      { id: "vendor.accounts.close@src/accounts.mjs:12", file: "src/accounts.mjs", line: 12, wrapper: "vendor", method: "accounts.close", kind: "write" },
      { id: "queue.jobs.enqueue@src/accounts.mjs:15", file: "src/accounts.mjs", line: 15, wrapper: "queue", method: "jobs.enqueue", kind: "write" },
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
