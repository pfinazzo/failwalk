import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { Inventory } from "../src/inventory/types";
import type { TraceSummary } from "../src/tracer/mergeTraces";
import { MODE_NAMES } from "../src/tracer/modes";
import { renderPage } from "../src/ui/render";
import { NOTICE_BY_STATUS, shapeScene, STATE_BY_VERDICT, type Report, type ReportCell } from "../src/ui/shape";
import { makeTempDir, runCli, SAMPLE_API } from "./helpers";

const ROOT = "/work/service";

/** A small inventory: two wrappers, three files, four sites. The second billing site carries a fired check. */
const INVENTORY: Inventory = {
  root: ROOT,
  wrappers: "config/**/*.js",
  wrapperBase: "config",
  wrapperFiles: ["config/billing.js", "config/database.js"],
  sites: [
    { id: "billing.subscriptions.retrieve@controllers/sync.js:12", file: "controllers/sync.js", line: 12, wrapper: "billing", method: "subscriptions.retrieve", kind: "read" },
    { id: "database.update@controllers/sync.js:14", file: "controllers/sync.js", line: 14, wrapper: "database", method: "update", kind: "write" },
    { id: "billing.subscriptions.create@controllers/signup.js:9", file: "controllers/signup.js", line: 9, wrapper: "billing", method: "subscriptions.create", kind: "write", checks: ["retry-without-idempotency-key"] } as Inventory["sites"][number],
    { id: "database.get@controllers/orphan.js:5", file: "controllers/orphan.js", line: 5, wrapper: "database", method: "get", kind: "read" },
  ],
  errors: [],
};

/** Two tests reach the sync sites, one reaches the signup site, nothing reaches the orphan. One test reached nothing. */
const TRACE: TraceSummary = {
  generatedAt: "2026-11-02T10:00:00.000Z",
  inventory: "/work/failwalk-inventory.json",
  testFiles: 2,
  tests: [
    { testPath: `${ROOT}/__tests__/sync.test.js`, name: "syncs the subscription", sites: ["billing.subscriptions.retrieve@controllers/sync.js:12", "database.update@controllers/sync.js:14"], uninventoried: [] },
    { testPath: `${ROOT}/__tests__/sync.test.js`, name: "answers 404 when billing has nothing", sites: ["billing.subscriptions.retrieve@controllers/sync.js:12"], uninventoried: [] },
    { testPath: `${ROOT}/__tests__/signup.test.js`, name: "creates the subscription", sites: ["billing.subscriptions.create@controllers/signup.js:9"], uninventoried: [] },
    { testPath: `${ROOT}/__tests__/unit.test.js`, name: "reaches no site", sites: [], uninventoried: [] },
  ],
  sites: {},
  unreached: ["database.get@controllers/orphan.js:5"],
  UNINVENTORIED: [],
  injection: null,
};

/**
 * Builds one report cell.
 *
 * @param params.site - site id
 * @param params.mode - mode name
 * @param params.verdict - the verdict
 * @param params.message - the first test's failure message, empty when it passed
 * @param params.checks - the checks behind a RISK
 * @returns the cell
 */
const cell = ({ site, mode, verdict, message = "", checks = [] }: { site: string; mode: ReportCell["mode"]; verdict: string; message?: string; checks?: string[] }): ReportCell => ({
  site,
  mode,
  verdict,
  checks,
  evidence:
    verdict === "UNREACHED"
      ? null
      : { ran: true, exitCode: message ? 1 : 0, fired: 2, tests: [{ file: "__tests__/sync.test.js", name: "t", outcome: message ? "error" : "passed", message }], runnerErrors: [], durationMs: 5 },
});

const SYNC = "billing.subscriptions.retrieve@controllers/sync.js:12";
const SIGNUP = "billing.subscriptions.create@controllers/signup.js:9";
const ORPHAN = "database.get@controllers/orphan.js:5";

/** A report with three modes, one cell per verdict the lookup knows, plus one the lookup does not. */
const REPORT: Report = {
  generatedAt: "2026-11-02T11:00:00.000Z",
  headline: "failwalk: 4 call sites, 3 modes, 12 cells.",
  plan: { modes: ["timeout", "500", "malformed"] },
  cells: [
    cell({ site: SYNC, mode: "timeout", verdict: "HANG", message: "Error: thrown: \"Exceeded timeout of 10000 ms for a test.\nmore" }),
    cell({ site: SYNC, mode: "500", verdict: "FAIL", message: "Error: expect(received).toBe(expected)\nmore" }),
    cell({ site: SYNC, mode: "malformed", verdict: "CRASH", message: "TypeError: Cannot read properties of undefined (reading 'status')" }),
    cell({ site: SIGNUP, mode: "timeout", verdict: "PASS" }),
    cell({ site: SIGNUP, mode: "500", verdict: "RISK", checks: ["retry-without-idempotency-key"] }),
    cell({ site: SIGNUP, mode: "malformed", verdict: "MOCKED" }),
    cell({ site: ORPHAN, mode: "timeout", verdict: "UNREACHED" }),
    cell({ site: ORPHAN, mode: "500", verdict: "UNREACHED" }),
    cell({ site: ORPHAN, mode: "malformed", verdict: "UNREACHED" }),
  ],
};

describe("shapeScene after a run (criteria 3, 4, 5)", () => {
  const scene = shapeScene({ inventory: INVENTORY, trace: TRACE, report: REPORT });

  test("takes the columns from the report's plan and the rows from the inventory, in order", () => {
    expect(scene.status).toBe("run");
    expect(scene.notice).toBe("");
    expect(scene.headline).toBe(REPORT.headline);
    expect(scene.modes).toEqual(["timeout", "500", "malformed"]);
    expect(scene.sites.map(({ id }) => id)).toEqual(INVENTORY.sites.map(({ id }) => id));
    expect(scene.sites.every((site) => site.cells.map(({ mode }) => mode).join()  === "timeout,500,malformed")).toBe(true);
  });

  test("groups sites under their wrapper in inventory order", () => {
    expect(scene.wrappers).toEqual([
      { name: "billing", sites: [SYNC, SIGNUP] },
      { name: "database", sites: ["database.update@controllers/sync.js:14", ORPHAN] },
    ]);
  });

  test("makes one beam per test that reached a site, labelled the way failwalk trace labels it", () => {
    expect(scene.tests.map(({ label }) => label)).toEqual([
      "__tests__/sync.test.js › syncs the subscription",
      "__tests__/sync.test.js › answers 404 when billing has nothing",
      "__tests__/signup.test.js › creates the subscription",
    ]);
    expect(scene.tests[0]).toEqual({ label: "__tests__/sync.test.js › syncs the subscription", file: "__tests__/sync.test.js", name: "syncs the subscription", sites: [SYNC, "database.update@controllers/sync.js:14"] });
    const sync = scene.sites.find(({ id }) => id === SYNC);
    expect(sync?.tests).toEqual(["__tests__/sync.test.js › answers 404 when billing has nothing", "__tests__/sync.test.js › syncs the subscription"]);
    expect(scene.sites.find(({ id }) => id === ORPHAN)?.tests).toEqual([]);
  });

  test("colours every verdict from the one lookup, and a verdict it does not know grey", () => {
    expect(STATE_BY_VERDICT).toEqual({ PASS: "coped", FAIL: "coped", CRASH: "uncaught", HANG: "uncaught", RISK: "risk", UNREACHED: "unreached" });
    const states = Object.fromEntries(scene.sites.flatMap((site) => site.cells.map((c) => [`${site.id}|${c.mode}`, [c.verdict, c.state]])));
    expect(states[`${SYNC}|timeout`]).toEqual(["HANG", "uncaught"]);
    expect(states[`${SYNC}|500`]).toEqual(["FAIL", "coped"]);
    expect(states[`${SYNC}|malformed`]).toEqual(["CRASH", "uncaught"]);
    expect(states[`${SIGNUP}|timeout`]).toEqual(["PASS", "coped"]);
    expect(states[`${SIGNUP}|500`]).toEqual(["RISK", "risk"]);
    expect(states[`${SIGNUP}|malformed`]).toEqual(["MOCKED", "unreached"]);
    expect(states[`${ORPHAN}|timeout`]).toEqual(["UNREACHED", "unreached"]);
  });

  test("keeps the site's checks and writes a note per cell: verdict, fired count, checks and the first failure line", () => {
    const signup = scene.sites.find(({ id }) => id === SIGNUP);
    expect(signup?.checks).toEqual(["retry-without-idempotency-key"]);
    expect(signup?.cells[0].note).toBe("PASS; fired 2 times");
    expect(signup?.cells[1].note).toBe("RISK; fired 2 times; checks: retry-without-idempotency-key");
    const sync = scene.sites.find(({ id }) => id === SYNC);
    expect(sync?.cells[0].note).toBe('HANG; fired 2 times; Error: thrown: "Exceeded timeout of 10000 ms for a test.');
    expect(sync?.cells[2].note).toBe("CRASH; fired 2 times; TypeError: Cannot read properties of undefined (reading 'status')");
    expect(scene.sites.find(({ id }) => id === ORPHAN)?.cells[0].note).toBe("Grey: no test reaches this call site, so no failure was ever injected here.");
  });

  test("gives a site the report never planned a grey cell per mode", () => {
    const unplanned = scene.sites.find(({ id }) => id === "database.update@controllers/sync.js:14");
    expect(unplanned?.cells.map(({ state }) => state)).toEqual(["unreached", "unreached", "unreached"]);
    expect(unplanned?.cells[0].verdict).toBeNull();
  });
});

describe("shapeScene before a run (criteria 3, 4, 5)", () => {
  test("with an inventory alone: every mode, every cell grey, and the notice says to trace then run", () => {
    const scene = shapeScene({ inventory: INVENTORY, trace: null, report: null });
    expect(scene.status).toBe("inventory-only");
    expect(scene.notice).toBe(NOTICE_BY_STATUS["inventory-only"]);
    expect(scene.notice).toContain("failwalk trace");
    expect(scene.modes).toEqual([...MODE_NAMES]);
    expect(scene.tests).toEqual([]);
    expect(scene.headline).toBeNull();
    expect(scene.sites.flatMap((site) => site.cells).every(({ state, verdict }) => state === "unreached" && verdict === null)).toBe(true);
    expect(scene.sites[0].cells[0].note).toBe("Grey: no trace yet, so nothing is known about this cell.");
  });

  test("with a trace but no run: beams are drawn, every cell is grey, and the notice says to run", () => {
    const scene = shapeScene({ inventory: INVENTORY, trace: TRACE, report: null });
    expect(scene.status).toBe("traced");
    expect(scene.notice).toBe(NOTICE_BY_STATUS.traced);
    expect(scene.tests).toHaveLength(3);
    expect(scene.generatedAt).toBe(TRACE.generatedAt);
    expect(scene.sites.flatMap((site) => site.cells).every(({ state }) => state === "unreached")).toBe(true);
    expect(scene.sites.find(({ id }) => id === SYNC)?.cells[0].note).toBe("Grey: 2 tests reach this site, but no run has filled the cell yet.");
    expect(scene.sites.find(({ id }) => id === ORPHAN)?.cells[0].note).toBe("Grey: no test reaches this call site.");
  });

  test("mutates none of its inputs", () => {
    const before = JSON.stringify({ INVENTORY, TRACE, REPORT });
    shapeScene({ inventory: INVENTORY, trace: TRACE, report: REPORT });
    expect(JSON.stringify({ INVENTORY, TRACE, REPORT })).toBe(before);
  });
});

describe("renderPage (criterion 2)", () => {
  test("puts the scene into the template as JSON that cannot close the script block, and pins Three.js to one version", () => {
    const scene = shapeScene({ inventory: { ...INVENTORY, root: "/work/<script>" }, trace: null, report: null });
    const html = renderPage({ scene });
    expect(html).not.toContain("__FAILWALK_DATA__");
    expect(html).toContain("\\u003cscript>");
    expect(html).not.toContain("</script>\"");
    expect(html.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@(\d+\.\d+\.\d+)\//g)?.length).toBeGreaterThan(0);
    expect(new Set(html.match(/three@(\d+\.\d+\.\d+)/g)).size).toBe(1);
    expect(html).not.toMatch(/<link[^>]+href="(?!https:\/\/fonts|data:)/);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });
});

describe("failwalk ui (criteria 1, 9)", () => {
  test("writes the page from the sample app's inventory alone, grey everywhere, and says what to run", () => {
    const dir = makeTempDir({ prefix: "failwalk-ui" });
    const inventory = path.join(dir, "failwalk-inventory.json");
    const made = runCli({ args: ["inventory", "--root", SAMPLE_API, "--wrappers", "config/**/*.js", "--out", inventory], cwd: dir });
    expect(made.status).toBe(0);
    const out = path.join(dir, "failwalk-ui.html");
    const result = runCli({ args: ["ui", "--inventory", inventory, "--out", out, "--no-open"], cwd: dir });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`written to ${out}`);
    expect(result.stderr).toContain("No trace yet");
    const html = fs.readFileSync(out, "utf8");
    const data = JSON.parse(html.slice(html.indexOf('id="failwalk-data">') + 'id="failwalk-data">'.length, html.indexOf("</script>", html.indexOf('id="failwalk-data">'))));
    expect(data.status).toBe("inventory-only");
    expect(data.sites.length).toBeGreaterThan(0);
    expect(data.sites.flatMap((site: { cells: { state: string }[] }) => site.cells).every(({ state }: { state: string }) => state === "unreached")).toBe(true);
  });

  test("names the inventory file when it is missing and says to run failwalk inventory", () => {
    const dir = makeTempDir({ prefix: "failwalk-ui" });
    const result = runCli({ args: ["ui", "--inventory", path.join(dir, "nope.json"), "--no-open"], cwd: dir });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(path.join(dir, "nope.json"));
    expect(result.stderr).toContain("failwalk inventory");
  });
});
