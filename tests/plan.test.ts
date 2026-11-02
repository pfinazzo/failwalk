import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { Inventory } from "../src/inventory/types";
import { buildPlan, formatPlanSummary, type Plan } from "../src/plan/buildPlan";
import type { TraceSummary } from "../src/tracer/mergeTraces";
import { MODE_NAMES } from "../src/tracer/modes";
import { makeTempDir, runCli, SAMPLE_API, writeSampleInventory } from "./helpers";

const ROOT = "/app";
const RETRIEVE = "billing.subscriptions.retrieve@controllers/subscriptions.js:12";
const SEND = "mailer.send@controllers/receipts.js:15";

const inventory: Inventory = {
  root: ROOT,
  wrappers: "config/**/*.js",
  wrapperBase: "config",
  wrapperFiles: ["config/billing.js", "config/mailer.js"],
  sites: [
    { id: RETRIEVE, file: "controllers/subscriptions.js", line: 12, wrapper: "billing", method: "subscriptions.retrieve", kind: "read" },
    { id: SEND, file: "controllers/receipts.js", line: 15, wrapper: "mailer", method: "send", kind: "write" },
  ],
  errors: [],
};

const trace: TraceSummary = {
  generatedAt: "2026-11-02T00:00:00.000Z",
  inventory: "/work/failwalk-inventory.json",
  testFiles: 2,
  tests: [
    { testPath: `${ROOT}/__tests__/subscriptions.test.js`, name: "GET /subscriptions/:id syncs it", sites: [RETRIEVE], uninventoried: [] },
    { testPath: `${ROOT}/__tests__/subscriptions.test.js`, name: "GET /subscriptions/:id returns 404", sites: [RETRIEVE], uninventoried: [] },
    { testPath: `${ROOT}/__tests__/other.test.js`, name: "touches nothing", sites: [], uninventoried: [] },
    { testPath: `${ROOT}/__tests__/receipts.test.js`, name: "emails a receipt", sites: [SEND], uninventoried: [] },
    { testPath: null, name: "(test name unavailable)", sites: [RETRIEVE], uninventoried: [] },
  ],
  sites: { [RETRIEVE]: ["a", "b", "c"] },
  unreached: [],
  UNINVENTORIED: [],
  injection: null,
};

describe("the plan builder (criterion 2)", () => {
  test("makes one cell per (site, mode), in inventory order then grid order", () => {
    const plan = buildPlan({ inventory, trace });
    expect(plan.cells).toHaveLength(12);
    expect(plan.cells.every((cell) => cell.verdict === null)).toBe(true);
    expect(plan.modes).toEqual([...MODE_NAMES]);
    expect(plan.cells.map(({ site, mode }) => `${site} ${mode}`).slice(0, 7)).toEqual([
      `${RETRIEVE} timeout`,
      `${RETRIEVE} dropped`,
      `${RETRIEVE} 500`,
      `${RETRIEVE} 429`,
      `${RETRIEVE} malformed`,
      `${RETRIEVE} partial`,
      `${SEND} timeout`,
    ]);
  });

  test("lists, for a reached site, every test that reached it by file and full name, sorted", () => {
    const plan = buildPlan({ inventory, trace });
    const cell = plan.cells.find(({ site, mode }) => site === RETRIEVE && mode === "500");
    expect(cell?.verdict).toBeNull();
    expect(cell?.tests).toEqual([
      { testPath: `${ROOT}/__tests__/subscriptions.test.js`, file: "__tests__/subscriptions.test.js", name: "GET /subscriptions/:id returns 404" },
      { testPath: `${ROOT}/__tests__/subscriptions.test.js`, file: "__tests__/subscriptions.test.js", name: "GET /subscriptions/:id syncs it" },
    ]);
  });

  test("a site no test reached gets an empty test list and the verdict UNREACHED in every mode", () => {
    const plan = buildPlan({ inventory, trace: { ...trace, tests: trace.tests.filter((test) => !test.sites.includes(SEND)) } });
    const cells = plan.cells.filter(({ site }) => site === SEND);
    expect(cells).toHaveLength(MODE_NAMES.length);
    cells.forEach((cell) => expect(cell).toMatchObject({ tests: [], verdict: "UNREACHED" }));
  });

  test("a test whose file the runner cannot name is left out of the plan", () => {
    const plan = buildPlan({ inventory, trace });
    plan.cells.forEach((cell) => cell.tests.forEach((planned) => expect(planned.testPath).not.toBeNull()));
  });

  test("plans only the modes asked for", () => {
    const plan = buildPlan({ inventory, trace, modes: ["500"] });
    expect(plan.cells.map(({ mode }) => mode)).toEqual(["500", "500"]);
  });

  test("the summary counts cells to run and UNREACHED cells", () => {
    const summary = formatPlanSummary({ plan: buildPlan({ inventory, trace }) });
    expect(summary).toContain("failwalk plan: 12 cells (2 reached sites × 6 modes). 12 to run, 0 UNREACHED.");
    expect(summary).toContain(`${RETRIEVE}   2 tests`);
    expect(summary).toContain(`${SEND}   1 test\n`);
    expect(summary).toContain("    __tests__/receipts.test.js › emails a receipt");
    expect(summary).toContain("    __tests__/subscriptions.test.js › GET /subscriptions/:id syncs it");
  });
});

describe("failwalk plan on the sample app (criterion 2)", () => {
  test("writes failwalk-plan.json from the inventory and trace in the current folder", () => {
    const dir = makeTempDir({ prefix: "failwalk-plan" });
    writeSampleInventory({ dir });
    fs.writeFileSync(path.join(dir, "failwalk-trace.json"), JSON.stringify({ ...trace, tests: [] }));
    const { status, stdout } = runCli({ args: ["plan", "--root", SAMPLE_API], cwd: dir });
    expect(status).toBe(0);
    expect(stdout).toContain("60 cells");
    const plan = JSON.parse(fs.readFileSync(path.join(dir, "failwalk-plan.json"), "utf8")) as Plan;
    expect(plan.cells).toHaveLength(60);
    expect(plan.cells.every((cell) => cell.verdict === "UNREACHED" && cell.tests.length === 0)).toBe(true);
  });

  test("refuses an inventory made for another root", () => {
    const dir = makeTempDir({ prefix: "failwalk-plan-root" });
    writeSampleInventory({ dir });
    fs.writeFileSync(path.join(dir, "failwalk-trace.json"), JSON.stringify({ ...trace, tests: [] }));
    const { status, stderr } = runCli({ args: ["plan", "--root", dir], cwd: dir });
    expect(status).toBe(1);
    expect(stderr).toContain("was made for");
  });
});
