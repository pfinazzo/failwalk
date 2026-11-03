import type { PlanCell } from "../plan/buildPlan";
import type { ModeName } from "../tracer/modes";
import { VERDICT_ORDER, type CellEvidence, type Verdict } from "../verdicts";

/** A planned cell after its run: the verdict, the static checks that fired on its site, and the evidence when it ran. */
export type CellResult = Omit<PlanCell, "verdict"> & { verdict: Verdict; checks: string[]; evidence: CellEvidence | null };

/** How many cells ended with each verdict. */
export type VerdictCounts = Record<Verdict, number>;

/** How many characters of a failure message a terminal note shows. */
const NOTE_CHARS = 90;

/**
 * Counts cells per verdict. Every verdict is present, at zero when none ended that way.
 *
 * @param params.cells - the run's cells
 * @returns verdict to count
 */
export const countVerdicts = ({ cells }: { cells: readonly CellResult[] }): VerdictCounts =>
  cells.reduce<VerdictCounts>((acc, { verdict }) => ({ ...acc, [verdict]: acc[verdict] + 1 }), {
    CRASH: 0,
    HANG: 0,
    RISK: 0,
    FAIL: 0,
    PASS: 0,
    UNREACHED: 0,
  });

/**
 * The covered fraction: PASS and FAIL cells over all cells. Zero when there are no cells. RISK is not covered: the
 * tests passed, but the pattern the check found is what they did not test.
 *
 * @param params.cells - the run's cells
 * @returns a number from 0 to 1
 */
export const coveredFraction = ({ cells }: { cells: readonly CellResult[] }): number => {
  const counts = countVerdicts({ cells });
  return cells.length === 0 ? 0 : (counts.PASS + counts.FAIL) / cells.length;
};

/**
 * The one-line headline, the last line the run prints.
 *
 * @param params.sites - how many call sites the inventory has
 * @param params.modes - how many modes were planned
 * @param params.cells - the run's cells
 * @returns one line
 */
export const formatHeadline = ({ sites, modes, cells }: { sites: number; modes: number; cells: readonly CellResult[] }): string => {
  const counts = countVerdicts({ cells });
  const covered = counts.PASS + counts.FAIL;
  const percent = Math.round(coveredFraction({ cells }) * 100);
  return `failwalk: ${sites} call sites, ${modes} modes, ${cells.length} cells. ${covered} covered (${percent}%). ${counts.CRASH} CRASH, ${counts.HANG} HANG, ${counts.FAIL} FAIL, ${counts.RISK} RISK, ${counts.UNREACHED} UNREACHED.`;
};

/**
 * The exit code for a run: 1 when the covered fraction is below the floor, else 0. CRASH cells alone never fail the run.
 *
 * @param params.covered - the covered fraction
 * @param params.minCoverage - the floor, from 0 to 1
 * @returns 0 or 1
 */
export const exitCodeFor = ({ covered, minCoverage }: { covered: number; minCoverage: number }): number => (covered < minCoverage ? 1 : 0);

/**
 * A short note for one cell's row: how often the injection fired, the checks behind a RISK verdict, and the first line of the first failure.
 *
 * @param params.cell - the cell
 * @returns the note, empty for an UNREACHED cell
 */
const noteFor = ({ cell }: { cell: CellResult }): string => {
  if (!cell.evidence) return "";
  const failure = cell.evidence.tests.find(({ outcome }) => outcome !== "passed");
  const firstLine = (failure?.message || cell.evidence.runnerErrors[0] || "").split("\n")[0].slice(0, NOTE_CHARS);
  const checks = cell.verdict === "RISK" ? `checks: ${cell.checks.join(", ")}` : "";
  return [`fired ${cell.evidence.fired}`, checks, firstLine].filter((part) => part !== "").join("; ");
};

/**
 * Orders cells for the terminal: worst verdict first, then inventory order, then mode order.
 *
 * @param params.cells - cells of one wrapper, in plan order
 * @param params.modes - the modes in grid order
 * @returns a new sorted list
 */
const byVerdictThenPlan = ({ cells, modes }: { cells: readonly CellResult[]; modes: readonly ModeName[] }): CellResult[] =>
  cells
    .map((cell, index) => ({ cell, index }))
    .sort(
      (a, b) =>
        VERDICT_ORDER.indexOf(a.cell.verdict) - VERDICT_ORDER.indexOf(b.cell.verdict) ||
        a.index - b.index ||
        modes.indexOf(a.cell.mode) - modes.indexOf(b.cell.mode),
    )
    .map(({ cell }) => cell);

/**
 * Formats the terminal table: one block per wrapper, one row per cell naming the verdict, the mode and the site, CRASH, HANG and RISK rows first.
 *
 * @param params.cells - the run's cells, in plan order
 * @param params.modes - the modes in grid order
 * @returns multi-line text
 */
export const formatGrid = ({ cells, modes }: { cells: readonly CellResult[]; modes: readonly ModeName[] }): string => {
  const wrappers = [...new Set(cells.map(({ wrapper }) => wrapper))];
  const blocks = wrappers.map((wrapper) => {
    const own = cells.filter((cell) => cell.wrapper === wrapper);
    const counts = countVerdicts({ cells: own });
    const header = `${wrapper}   ${own.length} cells: ${VERDICT_ORDER.filter((verdict) => counts[verdict] > 0)
      .map((verdict) => `${counts[verdict]} ${verdict}`)
      .join(", ")}`;
    const rows = byVerdictThenPlan({ cells: own, modes }).map(
      (cell) => `  ${cell.verdict.padEnd(9)} ${cell.mode.padEnd(9)} ${cell.site}${noteFor({ cell }) ? `   ${noteFor({ cell })}` : ""}`,
    );
    return [header, ...rows].join("\n");
  });
  return blocks.join("\n\n");
};
