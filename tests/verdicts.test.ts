import { describe, expect, test } from "vitest";
import { classifyFailure, verdictFor, type CellEvidence, type TestEvidence, type TestOutcome } from "../src/verdicts";

const ASSERTION = "Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 200\nReceived: 500\n    at Object.toBe (x.js:1:1)";
const TIMEOUT = 'Error: thrown: "Exceeded timeout of 10000 ms for a test.\nAdd a timeout value to this test to increase the timeout."';
const INJECTED = "FailwalkInjectedError: database.update failed with HTTP 500 (injected by failwalk at database.update@c.js:51)\n    at update (c.js:51:12)";
const TYPE_ERROR = "TypeError: Cannot read properties of undefined (reading 'status')\n    at sync (c.js:14:3)";

/**
 * Builds evidence for a cell whose planned tests ended the given ways.
 *
 * @param params.outcomes - one outcome per planned test
 * @param params.ran - whether the runner produced results
 * @returns the evidence
 */
const evidenceWith = ({ outcomes, ran = true }: { outcomes: TestOutcome[]; ran?: boolean }): CellEvidence => ({
  ran,
  exitCode: outcomes.every((outcome) => outcome === "passed") ? 0 : 1,
  fired: 1,
  tests: outcomes.map((outcome, index): TestEvidence => ({ file: "t.test.js", name: `test ${index}`, outcome, message: "" })),
  runnerErrors: [],
  durationMs: 10,
});

describe("classifying one failure message", () => {
  test("an assertion failure starts with expect( after the error name, or carries Expected:", () => {
    expect(classifyFailure({ message: ASSERTION })).toBe("assertion");
    expect(classifyFailure({ message: "expect(received).toEqual(expected) // deep equality" })).toBe("assertion");
    expect(classifyFailure({ message: "Error: some wrapper said no\n\nExpected: 1\nReceived: 2" })).toBe("assertion");
  });

  test("the runner's timeout is a timeout", () => {
    expect(classifyFailure({ message: TIMEOUT })).toBe("timeout");
  });

  test("the injected error itself, or any other error, is an error", () => {
    expect(classifyFailure({ message: INJECTED })).toBe("error");
    expect(classifyFailure({ message: TYPE_ERROR })).toBe("error");
    expect(classifyFailure({ message: "" })).toBe("error");
  });
});

describe("the verdict lookup (criterion 5)", () => {
  test("all planned tests passed: PASS", () => {
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["passed", "passed"] }) })).toBe("PASS");
  });

  test("a test failed on an assertion: FAIL", () => {
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["passed", "assertion"] }) })).toBe("FAIL");
  });

  test("a test failed with the injected error or any other non-assertion error: CRASH", () => {
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["error", "passed"] }) })).toBe("CRASH");
  });

  test("a test ended by the runner's timeout: HANG", () => {
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["timeout", "passed"] }) })).toBe("HANG");
  });

  test("a runner exit with no results, or a planned test the runner never reported: CRASH", () => {
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["passed"], ran: false }) })).toBe("CRASH");
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["missing"] }) })).toBe("CRASH");
  });

  test("the worst outcome wins: CRASH over HANG over FAIL over PASS", () => {
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["assertion", "timeout", "error"] }) })).toBe("CRASH");
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["assertion", "timeout"] }) })).toBe("HANG");
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["assertion", "passed"] }) })).toBe("FAIL");
  });
});

describe("the RISK rule (criterion 9)", () => {
  test("a PASS whose site has a fired check is RISK", () => {
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["passed", "passed"] }), checks: ["unawaited-call"] })).toBe("RISK");
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["passed"] }), checks: ["swallowed-catch", "no-timeout"] })).toBe("RISK");
  });

  test("a PASS with no fired check stays PASS, with or without the checks argument", () => {
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["passed"] }), checks: [] })).toBe("PASS");
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["passed"] }) })).toBe("PASS");
  });

  test("every other verdict is unchanged by fired checks", () => {
    const checks = ["unawaited-call"];
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["assertion"] }), checks })).toBe("FAIL");
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["timeout"] }), checks })).toBe("HANG");
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["error"] }), checks })).toBe("CRASH");
    expect(verdictFor({ evidence: evidenceWith({ outcomes: ["passed"], ran: false }), checks })).toBe("CRASH");
  });
});
