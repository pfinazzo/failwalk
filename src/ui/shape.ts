import path from "node:path";
import type { CallSite, Inventory } from "../inventory/types";
import type { TraceSummary } from "../tracer/mergeTraces";
import { MODE_NAMES, type ModeName } from "../tracer/modes";
import type { CellEvidence } from "../verdicts";

/** An inventory record as any step writes it. `checks` arrives with the static checks step; older files have none. */
export type SiteRecord = CallSite & { checks?: string[] };

/** One cell of `failwalk.json` as the map reads it. The verdict is a string so a verdict a later step adds still draws. */
export type ReportCell = { site: string; mode: ModeName; verdict: string; checks?: string[]; evidence: CellEvidence | null };

/** The parts of `failwalk.json` the map reads. */
export type Report = { generatedAt?: string; headline?: string; plan: { modes: ModeName[] }; cells: ReportCell[] };

/** What a cell's colour means. */
export type CellState = "coped" | "uncaught" | "risk" | "unreached";

/** How far the three files got: an inventory alone, a trace too, or a finished run. */
export type SceneStatus = "inventory-only" | "traced" | "run";

/** One cell of the picture: a call site under one failure mode. `production` says what goes wrong today if this failure hits. */
export type SceneCell = { mode: ModeName; verdict: string | null; state: CellState; note: string; production: string };

/** One call-site node: the inventory record, the tests that reach it, and its row of cells. */
export type SceneSite = {
  id: string;
  file: string;
  line: number;
  wrapper: string;
  method: string;
  kind: string;
  checks: string[];
  tests: string[];
  cells: SceneCell[];
};

/** One test node: its label, where it is, and the sites it reaches. */
export type SceneTest = { label: string; file: string; name: string; sites: string[] };

/**
 * One wrapper group and the ids of its sites, in inventory order. `gaps` counts its cells that are not green.
 * `complete` is earned: true only after a run in which every cell of every site coped. Nothing is complete before a run.
 */
export type SceneWrapper = { name: string; sites: string[]; gaps: number; complete: boolean };

/** Everything the page draws. Written into the HTML as JSON. */
export type Scene = {
  root: string;
  status: SceneStatus;
  notice: string;
  headline: string | null;
  generatedAt: string | null;
  modes: ModeName[];
  wrappers: SceneWrapper[];
  sites: SceneSite[];
  tests: SceneTest[];
};

/** Verdict to colour. A verdict missing from the table, or no verdict at all, is grey. */
export const STATE_BY_VERDICT: Record<string, CellState> = {
  PASS: "coped",
  FAIL: "coped",
  CRASH: "uncaught",
  HANG: "uncaught",
  RISK: "risk",
  UNREACHED: "unreached",
};

/** The grey state every cell gets until a run says otherwise. */
const NO_VERDICT_STATE: CellState = "unreached";

/** What the page says to run next, by how far the files got. */
export const NOTICE_BY_STATUS: Record<SceneStatus, string> = {
  "inventory-only": "No trace yet, so every cell is grey. Run the suite with the setup file loaded, then failwalk trace, then failwalk run to fill the cells.",
  traced: "No run yet, so every cell is grey. Run failwalk run to fill the cells.",
  run: "",
};

/** How many characters of a failure message a cell's note keeps. */
const NOTE_CHARS = 120;

/** What a RISK means in production, by the static check that fired. */
const PRODUCTION_BY_CHECK: Record<string, string> = {
  "retry-without-idempotency-key": "The code retries this write without an idempotency key. A retry after a timeout can land the same charge or record twice.",
  "no-timeout": "This call has no timeout. A slow vendor holds the request for as long as it likes, and every waiting request holds a connection.",
  "swallowed-catch": "The catch swallows the error, so the caller carries on as if the call worked, with nothing to show that it did not.",
  "retry-without-backoff": "The retries fire back to back, so a vendor that is already struggling gets hit harder, and the loop burns through its attempts in a moment.",
  "unawaited-call": "Nothing waits for this call, so when it fails the error lands in the uncaught handler with no request left to answer.",
};

/** The fallback for a check the table does not name. */
const PRODUCTION_UNKNOWN_CHECK = "A static check found a pattern here that passing tests hide. Read the check's name and the enclosing function.";

/** What goes wrong in production today if this failure hits, by verdict. Writes get a second sentence, because a write that failed may still have landed. */
const PRODUCTION_BY_VERDICT: Record<string, (params: { kind: string; checks: readonly string[] }) => string> = {
  PASS: () => "A test has seen this failure here and the code coped.",
  FAIL: () => "A test has seen this failure here, noticed it, and asserted on what the code did.",
  CRASH: ({ kind }) =>
    `If this failure hits today, the error escapes with nothing to catch it. The request dies with a 500, and if this line runs in a job, the job dies with it.${kind === "write" ? " Whatever the write had already changed stays half done." : ""}`,
  HANG: ({ kind }) =>
    `If the vendor hangs on this call today, the request that hit this line waits until something upstream gives up. Each one holds a connection open while it waits, and enough of them in a row take the service down.${kind === "write" ? " The write may or may not have landed, and a retry sends it again." : ""}`,
  RISK: ({ checks }) => checks.map((check) => PRODUCTION_BY_CHECK[check] || PRODUCTION_UNKNOWN_CHECK).join(" "),
  UNREACHED: () => "Nobody knows. No test has ever seen this line fail, so what happens here in production is a guess.",
};

/** The sentence for a verdict the table does not know. */
const PRODUCTION_UNKNOWN_VERDICT = "The run gave this cell a verdict the map does not know, so treat it as unwalked.";

/**
 * Says what goes wrong in production today if this failure hits this call site. Pure.
 *
 * @param params.verdict - the cell's verdict, or null before a run
 * @param params.kind - read or write
 * @param params.checks - the checks that fired on the site
 * @returns one or two plain sentences
 */
export const productionText = ({ verdict, kind, checks }: { verdict: string | null; kind: string; checks: readonly string[] }): string =>
  verdict === null ? PRODUCTION_BY_VERDICT.UNREACHED({ kind, checks }) : (PRODUCTION_BY_VERDICT[verdict] || (() => PRODUCTION_UNKNOWN_VERDICT))({ kind, checks });

/**
 * Labels a traced test the way `failwalk trace` does: the file relative to the root, then the test name.
 *
 * @param params.testPath - absolute test file, or null when the runner could not name it
 * @param params.name - the test's full name
 * @param params.root - the inventory root
 * @returns `<file> › <name>`
 */
const testLabel = ({ testPath, name, root }: { testPath: string | null; name: string; root: string }): string =>
  `${testPath ? path.relative(root, testPath).split(path.sep).join("/") : "(unknown file)"} › ${name}`;

/**
 * Lists every traced test that reached at least one site, in trace order.
 *
 * @param params.trace - the merged trace, or null when there is none
 * @param params.root - the inventory root, which test files are made relative to
 * @returns the test nodes
 */
const toTests = ({ trace, root }: { trace: TraceSummary | null; root: string }): SceneTest[] =>
  (trace?.tests ?? [])
    .filter((test) => test.sites.length > 0)
    .map((test) => ({
      label: testLabel({ testPath: test.testPath, name: test.name, root }),
      file: test.testPath ? path.relative(root, test.testPath).split(path.sep).join("/") : "(unknown file)",
      name: test.name,
      sites: [...test.sites],
    }));

/**
 * Groups test labels by the site they reach, sorted so the output does not depend on test order.
 *
 * @param params.tests - the test nodes
 * @returns site id to test labels
 */
const testsBySite = ({ tests }: { tests: readonly SceneTest[] }): Record<string, string[]> =>
  tests
    .flatMap((test) => test.sites.map((site) => ({ site, label: test.label })))
    .reduce<Record<string, string[]>>((acc, { site, label }) => ({ ...acc, [site]: [...(acc[site] || []), label].sort() }), {});

/**
 * Indexes the report's cells by site and mode.
 *
 * @param params.report - the run report, or null
 * @returns `<site>\n<mode>` to the cell
 */
const cellsByKey = ({ report }: { report: Report | null }): Record<string, ReportCell> =>
  (report?.cells ?? []).reduce<Record<string, ReportCell>>((acc, cell) => ({ ...acc, [`${cell.site}\n${cell.mode}`]: cell }), {});

/**
 * The note for a cell that ran: the verdict, how often the injection fired, the checks behind a RISK, and the first failure line.
 *
 * @param params.cell - the report cell
 * @returns one line
 */
const ranNote = ({ cell }: { cell: ReportCell }): string => {
  const evidence = cell.evidence;
  const failure = evidence?.tests.find(({ outcome }) => outcome !== "passed");
  const firstLine = (failure?.message || evidence?.runnerErrors[0] || "").split("\n")[0].slice(0, NOTE_CHARS);
  const fired = evidence ? `fired ${evidence.fired} time${evidence.fired === 1 ? "" : "s"}` : "";
  const checks = cell.verdict === "RISK" && cell.checks?.length ? `checks: ${cell.checks.join(", ")}` : "";
  return [cell.verdict, fired, checks, firstLine].filter((part) => part !== "").join("; ");
};

/** The note for a grey cell, by how far the files got and whether a test reaches the site. */
const GREY_NOTES: Record<SceneStatus, (params: { reached: number }) => string> = {
  "inventory-only": () => "Grey: no trace yet, so nothing is known about this cell.",
  traced: ({ reached }) => (reached ? `Grey: ${reached} test${reached === 1 ? "" : "s"} reach this site, but no run has filled the cell yet.` : "Grey: no test reaches this call site."),
  run: () => "Grey: no test reaches this call site, so no failure was ever injected here.",
};

/**
 * Builds one cell of a site's row. A cell the report holds takes its verdict and note from the run; any other cell is grey with a sentence saying why.
 *
 * @param params.site - the inventory record
 * @param params.mode - the mode
 * @param params.cells - the report's cells by key
 * @param params.status - how far the files got
 * @param params.reached - how many tests reach the site
 * @returns the cell
 */
const toCell = ({
  site,
  mode,
  cells,
  status,
  reached,
}: {
  site: SiteRecord;
  mode: ModeName;
  cells: Record<string, ReportCell>;
  status: SceneStatus;
  reached: number;
}): SceneCell => {
  const ran = cells[`${site.id}\n${mode}`];
  const checks = site.checks ?? [];
  if (!ran) return { mode, verdict: null, state: NO_VERDICT_STATE, note: GREY_NOTES[status]({ reached }), production: productionText({ verdict: null, kind: site.kind, checks }) };
  const state = STATE_BY_VERDICT[ran.verdict] || NO_VERDICT_STATE;
  const note = state === "unreached" ? GREY_NOTES.run({ reached }) : ranNote({ cell: ran });
  return { mode, verdict: ran.verdict, state, note, production: productionText({ verdict: ran.verdict, kind: site.kind, checks }) };
};

/**
 * Builds one site node from its inventory record.
 *
 * @param params.site - the inventory record
 * @param params.modes - the modes in grid order
 * @param params.reached - site id to the tests that reach it
 * @param params.cells - the report's cells by key
 * @param params.status - how far the files got
 * @returns the site node
 */
const toSite = ({
  site,
  modes,
  reached,
  cells,
  status,
}: {
  site: SiteRecord;
  modes: readonly ModeName[];
  reached: Record<string, string[]>;
  cells: Record<string, ReportCell>;
  status: SceneStatus;
}): SceneSite => {
  const tests = reached[site.id] || [];
  return {
    id: site.id,
    file: site.file,
    line: site.line,
    wrapper: site.wrapper,
    method: site.method,
    kind: site.kind,
    checks: [...(site.checks ?? [])],
    tests,
    cells: modes.map((mode) => toCell({ site, mode, cells, status, reached: tests.length })),
  };
};

/**
 * Lists the wrappers in inventory order, each with its site ids, its gap count, and whether it has earned "complete".
 *
 * @param params.sites - the shaped sites
 * @param params.status - how far the files got; nothing is complete before a run
 * @returns the wrapper groups
 */
const toWrappers = ({ sites, status }: { sites: readonly SceneSite[]; status: SceneStatus }): SceneWrapper[] =>
  [...new Set(sites.map(({ wrapper }) => wrapper))].map((name) => {
    const own = sites.filter((site) => site.wrapper === name);
    const gaps = own.flatMap((site) => site.cells).filter((cell) => cell.state !== "coped").length;
    return { name, sites: own.map(({ id }) => id), gaps, complete: status === "run" && gaps === 0 };
  });

/**
 * Says how far the files got. A report means a run; a trace alone means traced; the inventory alone is the start.
 *
 * @param params.trace - the trace or null
 * @param params.report - the report or null
 * @returns the status
 */
const statusOf = ({ trace, report }: { trace: TraceSummary | null; report: Report | null }): SceneStatus =>
  report ? "run" : trace ? "traced" : "inventory-only";

/**
 * Shapes the three files into what the page draws. Pure.
 *
 * @param params.inventory - the inventory, always present
 * @param params.trace - the merged trace, or null when there is none yet
 * @param params.report - the run report, or null when there is no run yet
 * @returns the scene
 */
export const shapeScene = ({ inventory, trace, report }: { inventory: Inventory; trace: TraceSummary | null; report: Report | null }): Scene => {
  const status = statusOf({ trace, report });
  const modes = report ? [...report.plan.modes] : [...MODE_NAMES];
  const tests = toTests({ trace, root: inventory.root });
  const reached = testsBySite({ tests });
  const cells = cellsByKey({ report });
  const sites = (inventory.sites as SiteRecord[]).map((site) => toSite({ site, modes, reached, cells, status }));
  return {
    root: inventory.root,
    status,
    notice: NOTICE_BY_STATUS[status],
    headline: report?.headline ?? null,
    generatedAt: report?.generatedAt ?? trace?.generatedAt ?? null,
    modes,
    wrappers: toWrappers({ sites, status }),
    sites,
    tests,
  };
};
