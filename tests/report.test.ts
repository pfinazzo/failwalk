import { describe, expect, test } from "vitest";
import { cellJestArgs, escapeRegex, runnerEnv } from "../src/run/jestArgs";
import { countVerdicts, coveredFraction, exitCodeFor, formatGrid, formatHeadline, type CellResult } from "../src/run/report";
import { MODE_NAMES } from "../src/tracer/modes";
import type { CellEvidence, Verdict } from "../src/verdicts";

/**
 * Builds a cell result with the given verdict and a one-line failure message.
 *
 * @param params.site - site id
 * @param params.wrapper - wrapper name
 * @param params.mode - mode name
 * @param params.verdict - the verdict
 * @param params.checks - the checks that fired on the site
 * @returns the cell
 */
const cell = ({ site, wrapper, mode, verdict, checks = [] }: { site: string; wrapper: string; mode: CellResult["mode"]; verdict: Verdict; checks?: string[] }): CellResult => {
  const evidence: CellEvidence | null =
    verdict === "UNREACHED"
      ? null
      : {
          ran: true,
          exitCode: verdict === "PASS" || verdict === "RISK" ? 0 : 1,
          fired: 1,
          tests: [{ file: "t.test.js", name: "t", outcome: verdict === "PASS" || verdict === "RISK" ? "passed" : "error", message: verdict === "PASS" || verdict === "RISK" ? "" : `${verdict} happened here\nmore` }],
          runnerErrors: [],
          durationMs: 1,
        };
  return { site, wrapper, mode, tests: [], verdict, checks, evidence };
};

const CELLS: CellResult[] = [
  cell({ site: "billing.retrieve@a.js:1", wrapper: "billing", mode: "timeout", verdict: "HANG" }),
  cell({ site: "billing.retrieve@a.js:1", wrapper: "billing", mode: "500", verdict: "FAIL" }),
  cell({ site: "billing.retrieve@a.js:1", wrapper: "billing", mode: "malformed", verdict: "PASS" }),
  cell({ site: "database.update@b.js:9", wrapper: "database", mode: "timeout", verdict: "PASS" }),
  cell({ site: "database.update@b.js:9", wrapper: "database", mode: "500", verdict: "CRASH" }),
  cell({ site: "database.update@b.js:9", wrapper: "database", mode: "malformed", verdict: "RISK", checks: ["unawaited-call", "no-timeout"] }),
  cell({ site: "mailer.send@c.js:2", wrapper: "mailer", mode: "timeout", verdict: "UNREACHED" }),
  cell({ site: "mailer.send@c.js:2", wrapper: "mailer", mode: "500", verdict: "UNREACHED" }),
];

describe("the headline (criterion 10)", () => {
  test("has the spec's exact shape with RISK after FAIL, and counts PASS and FAIL as covered but not RISK", () => {
    expect(formatHeadline({ sites: 3, modes: 2, cells: CELLS })).toBe("failwalk: 3 call sites, 2 modes, 8 cells. 3 covered (38%). 1 CRASH, 1 HANG, 1 FAIL, 1 RISK, 2 UNREACHED.");
    expect(countVerdicts({ cells: CELLS })).toEqual({ CRASH: 1, HANG: 1, RISK: 1, FAIL: 1, PASS: 2, UNREACHED: 2 });
    expect(coveredFraction({ cells: CELLS })).toBeCloseTo(3 / 8);
    expect(formatHeadline({ sites: 0, modes: 6, cells: [] })).toBe("failwalk: 0 call sites, 6 modes, 0 cells. 0 covered (0%). 0 CRASH, 0 HANG, 0 FAIL, 0 RISK, 0 UNREACHED.");
  });
});

describe("the exit code (criterion 8)", () => {
  test("is 1 only when the covered fraction is below the floor", () => {
    expect(exitCodeFor({ covered: 0.43, minCoverage: 0 })).toBe(0);
    expect(exitCodeFor({ covered: 0.43, minCoverage: 0.43 })).toBe(0);
    expect(exitCodeFor({ covered: 0.43, minCoverage: 0.5 })).toBe(1);
    expect(exitCodeFor({ covered: 0, minCoverage: 0 })).toBe(0);
  });
});

describe("the terminal table (criterion 10)", () => {
  test("groups cells by wrapper and lists CRASH, HANG and RISK rows first, each naming verdict, mode and site, RISK rows naming their checks", () => {
    const grid = formatGrid({ cells: CELLS, modes: MODE_NAMES });
    const lines = grid.split("\n");
    expect(lines[0]).toBe("billing   3 cells: 1 HANG, 1 FAIL, 1 PASS");
    expect(lines[1]).toMatch(/^ {2}HANG {6}timeout {3}billing\.retrieve@a\.js:1 {3}fired 1; HANG happened here$/);
    expect(lines[2]).toMatch(/^ {2}FAIL {6}500 {7}billing\.retrieve@a\.js:1/);
    expect(lines[3]).toMatch(/^ {2}PASS {6}malformed billing\.retrieve@a\.js:1 {3}fired 1$/);
    expect(lines[5]).toBe("database   3 cells: 1 CRASH, 1 RISK, 1 PASS");
    expect(lines[6]).toMatch(/^ {2}CRASH {5}500 {7}database\.update@b\.js:9/);
    expect(lines[7]).toBe("  RISK      malformed database.update@b.js:9   fired 1; checks: unawaited-call, no-timeout");
    expect(lines[8]).toMatch(/^ {2}PASS {6}timeout {3}database\.update@b\.js:9/);
    expect(lines[10]).toBe("mailer   2 cells: 2 UNREACHED");
    expect(lines[11]).toBe("  UNREACHED timeout   mailer.send@c.js:2");
  });
});

describe("runner arguments for one cell (criteria 3 and 4)", () => {
  const tests = [
    { testPath: "/app/__tests__/a.test.js", file: "__tests__/a.test.js", name: "GET /x (one) syncs $it" },
    { testPath: "/app/__tests__/a.test.js", file: "__tests__/a.test.js", name: "GET /x returns 404" },
    { testPath: "/app/__tests__/b.test.js", file: "__tests__/b.test.js", name: "lists" },
  ];

  test("filters to exactly the planned files and names, escaped, with the timeout failwalk sets", () => {
    const args = cellJestArgs({ config: "/app/jest.failwalk.config.js", outputFile: "/w/jest.json", testTimeoutMs: 2500, tests });
    expect(args.slice(0, 7)).toEqual(["--config", "/app/jest.failwalk.config.js", "--json", "--outputFile", "/w/jest.json", "--testTimeout", "2500"]);
    expect(args).toContain("--forceExit");
    expect(args).toContain("--runInBand");
    const pathIndex = args.indexOf("--testPathPatterns");
    expect(args.slice(pathIndex + 1, pathIndex + 3)).toEqual(["^\\/app\\/__tests__\\/a\\.test\\.js$", "^\\/app\\/__tests__\\/b\\.test\\.js$"]);
    const namePattern = args[args.indexOf("--testNamePattern") + 1];
    expect(namePattern).toBe("^(GET \\/x \\(one\\) syncs \\$it|GET \\/x returns 404|lists)$");
    expect(new RegExp(namePattern).test("GET /x (one) syncs $it")).toBe(true);
    expect(new RegExp(namePattern).test("GET /x (one) syncs $it and more")).toBe(false);
  });

  test("escapes every regular-expression character", () => {
    expect(escapeRegex({ text: "a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o/p" })).toBe("a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o\\/p");
  });

  test("the child environment sets the pair for a cell and strips a stale pair for the baseline", () => {
    const base = { PATH: "/bin", FAILWALK_SITE: "stale@x:1", FAILWALK_MODE: "500" };
    const forCell = runnerEnv({ base, inventoryFile: "/w/inv.json", traceDir: "/w/t", setupFile: "/d/setup.js", injection: { site: "s@a.js:1", mode: "dropped" } });
    expect(forCell).toEqual({ PATH: "/bin", FAILWALK_INVENTORY: "/w/inv.json", FAILWALK_TRACE_DIR: "/w/t", FAILWALK_SETUP: "/d/setup.js", FAILWALK_SITE: "s@a.js:1", FAILWALK_MODE: "dropped" });
    const forBaseline = runnerEnv({ base, inventoryFile: "/w/inv.json", traceDir: "/w/t", setupFile: "/d/setup.js", injection: null });
    expect(forBaseline).not.toHaveProperty("FAILWALK_SITE");
    expect(forBaseline).not.toHaveProperty("FAILWALK_MODE");
    expect(base.FAILWALK_SITE).toBe("stale@x:1");
  });
});
