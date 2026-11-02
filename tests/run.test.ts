import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import type { RunReport } from "../src/run/runCommand";
import { makeTempDir, runCli, SAMPLE_API } from "./helpers";

const VIEW_UPDATE = "database.update@controllers/subscriptions.js:51";
const CANCEL = "billing.subscriptions.cancel@controllers/subscriptions.js:33";
const LIST_INVOICES = "billing.invoices.list@controllers/invoices.js:18";
const SIGNUP_CREATE = "billing.subscriptions.create@controllers/signups.js:13";
const SWALLOWED_REMOVE = "database.remove@controllers/swallowedCatch.js:16";
const LOGIN_UPDATE = "database.update@controllers/unawaitedCall.js:14";
const RETRY_CREATE = "billing.subscriptions.create@controllers/retryWithoutKey.js:25";
const UNREACHED_SITES = ["database.get@controllers/receipts.js:13", "mailer.send@controllers/receipts.js:15", "database.update@controllers/subscriptions.js:37"];

/** One full run of the sample app, shared by the tests below. */
let walk: { status: number | null; stdout: string; stderr: string; report: RunReport; dir: string };

beforeAll(() => {
  const dir = makeTempDir({ prefix: "failwalk-run" });
  const result = runCli({
    args: ["run", "--root", SAMPLE_API, "--wrappers", "config/**/*.js", "--out-dir", dir, "--test-timeout-ms", "2000"],
    cwd: dir,
  });
  const reportFile = path.join(dir, "failwalk.json");
  if (!fs.existsSync(reportFile)) throw new Error(`run wrote no failwalk.json: ${result.stderr}`);
  walk = { ...result, report: JSON.parse(fs.readFileSync(reportFile, "utf8")) as RunReport, dir };
}, 120_000); // The walk runs 72 cells, ten of them two-second hangs: longer than the default hook timeout.

/**
 * Finds one cell of the shared run.
 *
 * @param params.site - site id
 * @param params.mode - mode name
 * @returns the cell
 */
const cellOf = ({ site, mode }: { site: string; mode: string }) => {
  const found = walk.report.cells.find((cell) => cell.site === site && cell.mode === mode);
  if (!found) throw new Error(`no cell for ${site} ${mode}`);
  return found;
};

describe("failwalk run on the sample app (criteria 9 to 11)", () => {
  test("exits 0 with the default floor even though some cells are CRASH", () => {
    expect(walk.status).toBe(0);
    expect(walk.report.counts.CRASH).toBeGreaterThan(0);
  });

  test("prints the headline as the last line, matching the report", () => {
    const lines = walk.stdout.trimEnd().split("\n");
    expect(lines.at(-1)).toBe(walk.report.headline);
    expect(lines.at(-1)).toMatch(/^failwalk: 15 call sites, 6 modes, 90 cells\. \d+ covered \(\d+%\)\. \d+ CRASH, \d+ HANG, \d+ FAIL, \d+ RISK, 18 UNREACHED\.$/);
  });

  test("writes failwalk.json with the inventory, the plan, and every cell's verdict, tests and exit code", () => {
    expect(walk.report.inventory.sites).toHaveLength(15);
    expect(walk.report.plan.cells).toHaveLength(90);
    expect(walk.report.cells).toHaveLength(90);
    walk.report.cells.forEach((cell) => {
      expect(["PASS", "FAIL", "CRASH", "HANG", "RISK", "UNREACHED"]).toContain(cell.verdict);
      expect(Array.isArray(cell.checks)).toBe(true);
      if (cell.verdict === "UNREACHED") {
        expect(cell.tests).toEqual([]);
        expect(cell.evidence).toBeNull();
        return;
      }
      expect(cell.tests.length).toBeGreaterThan(0);
      expect(typeof cell.evidence?.exitCode).toBe("number");
      expect(cell.evidence?.tests.map(({ name }) => name)).toEqual(cell.tests.map(({ name }) => name));
    });
    ["failwalk-inventory.json", "failwalk-trace.json", "failwalk-plan.json"].forEach((name) => expect(fs.existsSync(path.join(walk.dir, name))).toBe(true));
  });

  test("the floating write at line 51 is CRASH under 500 and dropped, and the injection fired once", () => {
    expect(cellOf({ site: VIEW_UPDATE, mode: "500" })).toMatchObject({ verdict: "CRASH", evidence: { fired: 1, exitCode: 1 } });
    expect(cellOf({ site: VIEW_UPDATE, mode: "dropped" }).verdict).toBe("CRASH");
    expect(cellOf({ site: VIEW_UPDATE, mode: "500" }).evidence?.tests[0].message).toMatch(/^FailwalkInjectedError: database\.update failed with HTTP 500/);
  });

  test("the awaited signup call is HANG under timeout and FAIL under malformed, and the route answers 502 on a vendor error", () => {
    expect(cellOf({ site: SIGNUP_CREATE, mode: "500" }).evidence?.tests[0].message).toContain("Received: 502");
    expect(cellOf({ site: SIGNUP_CREATE, mode: "timeout" })).toMatchObject({ verdict: "HANG", evidence: { fired: 1 } });
    expect(cellOf({ site: SIGNUP_CREATE, mode: "timeout" }).evidence?.tests[0].message).toContain("Exceeded timeout of 2000 ms");
    expect(cellOf({ site: SIGNUP_CREATE, mode: "malformed" })).toMatchObject({ verdict: "FAIL", evidence: { fired: 1 } });
  });

  test("the cancel inside try/catch is FAIL under 500, and the retry loop fires the injection six times", () => {
    expect(cellOf({ site: CANCEL, mode: "500" }).verdict).toBe("FAIL");
    expect(cellOf({ site: CANCEL, mode: "500" }).evidence?.tests[0].message).toContain("Received: 202");
    expect(cellOf({ site: LIST_INVOICES, mode: "500" })).toMatchObject({ verdict: "FAIL", evidence: { fired: 6 } });
    expect(cellOf({ site: LIST_INVOICES, mode: "partial" })).toMatchObject({ verdict: "FAIL", evidence: { fired: 2 } });
  });

  test("a PASS whose site has a fired check is RISK, records the check names, and is not counted as covered", () => {
    expect(cellOf({ site: SWALLOWED_REMOVE, mode: "500" })).toMatchObject({ verdict: "RISK", checks: ["swallowed-catch"], evidence: { fired: 1, exitCode: 0 } });
    expect(cellOf({ site: SWALLOWED_REMOVE, mode: "timeout" })).toMatchObject({ verdict: "HANG", checks: ["swallowed-catch"] });
    expect(cellOf({ site: LOGIN_UPDATE, mode: "timeout" })).toMatchObject({ verdict: "RISK", checks: ["unawaited-call"] });
    expect(cellOf({ site: LOGIN_UPDATE, mode: "500" })).toMatchObject({ verdict: "CRASH", checks: ["unawaited-call"] });
    expect(cellOf({ site: VIEW_UPDATE, mode: "timeout" })).toMatchObject({ verdict: "RISK", checks: ["unawaited-call"] });
    expect(cellOf({ site: RETRY_CREATE, mode: "malformed" })).toMatchObject({ verdict: "RISK", checks: ["retry-without-idempotency-key"] });
    expect(cellOf({ site: RETRY_CREATE, mode: "500" })).toMatchObject({ verdict: "FAIL", evidence: { fired: 3 } });
    expect(cellOf({ site: "database.update@controllers/subscriptions.js:14", mode: "malformed" })).toMatchObject({ verdict: "PASS", checks: [] });
    const { counts } = walk.report;
    expect(counts.RISK).toBeGreaterThan(0);
    expect(walk.report.covered).toBeCloseTo((counts.PASS + counts.FAIL) / 90);
    expect(walk.report.headline).toContain(`${counts.FAIL} FAIL, ${counts.RISK} RISK, ${counts.UNREACHED} UNREACHED.`);
  });

  test("the receipt path and the catch path are UNREACHED in every mode", () => {
    UNREACHED_SITES.forEach((site) => walk.report.plan.modes.forEach((mode) => expect(cellOf({ site, mode }).verdict).toBe("UNREACHED")));
  });

  test("every verdict except MOCKED appears in the terminal table, grouped by wrapper with CRASH, HANG and RISK first, RISK rows naming their checks", () => {
    ["PASS", "FAIL", "CRASH", "HANG", "RISK", "UNREACHED"].forEach((verdict) => expect(walk.report.counts[verdict as keyof typeof walk.report.counts]).toBeGreaterThan(0));
    const lines = walk.stdout.split("\n");
    const databaseStart = lines.findIndex((line) => line.startsWith("database   "));
    expect(lines[databaseStart + 1]).toMatch(/^ {2}CRASH /);
    const databaseVerdicts = lines.slice(databaseStart + 1).slice(0, 42).map((line) => line.trim().split(/\s+/)[0]);
    const firstRisk = databaseVerdicts.indexOf("RISK");
    const firstFail = databaseVerdicts.indexOf("FAIL");
    expect(databaseVerdicts.lastIndexOf("HANG")).toBeLessThan(firstRisk);
    expect(databaseVerdicts.lastIndexOf("RISK")).toBeLessThan(firstFail);
    expect(lines).toContainEqual(expect.stringMatching(/^ {2}RISK {6}500 {7}database\.remove@controllers\/swallowedCatch\.js:16 {3}fired 1; checks: swallowed-catch$/));
    const billingStart = lines.findIndex((line) => line.startsWith("billing   "));
    expect(lines[billingStart + 1]).toMatch(/^ {2}HANG {6}timeout/);
  });

  test("ran the cells through the pool: several runner processes were in flight at once", () => {
    // Progress lines are written as cells finish. Under a serial run they would be numbered in order.
    const order = walk.stderr
      .split("\n")
      .flatMap((line) => (/^\[(\d+)\/\d+\]/.exec(line) ? [Number(RegExp.$1)] : []));
    expect(order.length).toBe(72);
    expect(order).not.toEqual([...order].sort((a, b) => a - b));
  });

  test("exits 1 when the covered fraction is below --min-coverage", () => {
    const dir = makeTempDir({ prefix: "failwalk-run-floor" });
    const { status, stdout } = runCli({
      args: ["run", "--root", SAMPLE_API, "--wrappers", "config/**/*.js", "--out-dir", dir, "--modes", "500", "--min-coverage", "0.95", "--concurrency", "2"],
      cwd: dir,
    });
    expect(status).toBe(1);
    expect(stdout.trimEnd().split("\n").at(-1)).toMatch(/^failwalk: 15 call sites, 1 modes, 15 cells\./);
  });
});
