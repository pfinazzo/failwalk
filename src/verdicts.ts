/** One verdict per cell. This step produces these five; RISK and MOCKED are later steps. */
export type Verdict = "PASS" | "FAIL" | "CRASH" | "HANG" | "UNREACHED";

/** How one planned test ended under injection. `missing` means the runner reported no result for it. */
export type TestOutcome = "passed" | "assertion" | "timeout" | "error" | "missing";

/** What one planned test did, as the cell's evidence keeps it. */
export type TestEvidence = { file: string; name: string; outcome: TestOutcome; message: string };

/** What the runner did for one cell: the input of the verdict lookup. */
export type CellEvidence = {
  /** False when the runner produced no results at all: it died, or every suite failed to load. */
  ran: boolean;
  exitCode: number | null;
  /** How many times the injection fired, summed over the trace records the run wrote. */
  fired: number;
  tests: TestEvidence[];
  /** Suite-level messages when a test file failed to run, and the runner's last lines when it died. */
  runnerErrors: string[];
  durationMs: number;
};

/** The verdicts in the order the terminal lists them: the worst first. */
export const VERDICT_ORDER: readonly Verdict[] = ["CRASH", "HANG", "FAIL", "PASS", "UNREACHED"];

/** A runner failure message starts with the error's name. Assertion errors from the runner's matchers start with `expect(` after it. */
const LEADING_ERROR_NAME = /^\w*Error: /;

/** Each kind of failure message, tested in order. The last row matches anything, so an unknown shape is an error, never a pass. */
const FAILURE_KINDS: readonly { outcome: TestOutcome; matches: (params: { message: string }) => boolean }[] = [
  { outcome: "timeout", matches: ({ message }) => /Exceeded timeout of \d+\s*ms/.test(message) },
  {
    outcome: "assertion",
    matches: ({ message }) => message.replace(LEADING_ERROR_NAME, "").startsWith("expect(") || message.includes("Expected:"),
  },
  { outcome: "error", matches: () => true },
];

/**
 * Classifies one failed test by its first failure message.
 *
 * @param params.message - the runner's failure message for the test
 * @returns timeout, assertion or error
 */
export const classifyFailure = ({ message }: { message: string }): TestOutcome =>
  (FAILURE_KINDS.find((kind) => kind.matches({ message })) as (typeof FAILURE_KINDS)[number]).outcome;

/**
 * The verdict rules, tested in order. The first row whose condition holds names the verdict.
 * A planned test with no result counts as a crash: the runner lost it, and a lost test proves nothing.
 */
const VERDICT_RULES: readonly { verdict: Verdict; when: (params: { evidence: CellEvidence }) => boolean }[] = [
  { verdict: "CRASH", when: ({ evidence }) => !evidence.ran },
  { verdict: "CRASH", when: ({ evidence }) => evidence.tests.some(({ outcome }) => outcome === "error" || outcome === "missing") },
  { verdict: "HANG", when: ({ evidence }) => evidence.tests.some(({ outcome }) => outcome === "timeout") },
  { verdict: "FAIL", when: ({ evidence }) => evidence.tests.some(({ outcome }) => outcome === "assertion") },
  { verdict: "PASS", when: () => true },
];

/**
 * Looks up the verdict for one cell from what its run did. Pure.
 *
 * @param params.evidence - the cell's runner evidence
 * @returns the verdict
 */
export const verdictFor = ({ evidence }: { evidence: CellEvidence }): Verdict =>
  (VERDICT_RULES.find((rule) => rule.when({ evidence })) as (typeof VERDICT_RULES)[number]).verdict;
