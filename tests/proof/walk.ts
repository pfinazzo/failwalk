import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunReport } from "../../src/run/runCommand";
import type { CellResult } from "../../src/run/report";
import { CLI, REPO, SAMPLE_API } from "../helpers";

/** A fresh copy of the sample app in its own temp folder, with where failwalk's output for it goes. */
export type SampleCopy = { dir: string; root: string; outDir: string };

/** What one `failwalk run` on a copy produced. */
export type Walk = { status: number | null; stdout: string; stderr: string; report: RunReport };

/** The per-test timeout given to the runner, so a `timeout` injection costs two seconds instead of ten. */
const TEST_TIMEOUT_MS = "2000";

/**
 * Copies the sample app into a fresh folder under the OS temp directory and links the repo's node_modules into it,
 * so the copy's tests can load express, supertest and jest. The temp path is resolved to its real path first: on macOS
 * the temp folder is a symlink, and stack frames name real paths, so an unresolved root would match no call site.
 *
 * @returns the copy's folders
 */
export const copySampleApp = (): SampleCopy => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "failwalk-proof-"));
  const root = path.join(dir, "sample-api");
  fs.cpSync(SAMPLE_API, root, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules`) });
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(root, "node_modules"));
  const outDir = path.join(dir, "out");
  fs.mkdirSync(outDir);
  return { dir, root, outDir };
};

/**
 * Deletes one copy's temp folder, with everything failwalk wrote under it.
 *
 * @param params.copy - the copy to remove
 */
export const removeCopy = ({ copy }: { copy: SampleCopy }): void => fs.rmSync(copy.dir, { recursive: true, force: true });

/**
 * Runs `failwalk run` on one copy and reads the failwalk.json it wrote. Throws when no report was written, with the
 * runner's stderr, because a walk that wrote nothing is a broken setup and not a missed seed.
 *
 * @param params.copy - the copy to walk
 * @returns the exit status, both output streams and the parsed report
 */
export const walkCopy = ({ copy }: { copy: SampleCopy }): Promise<Walk> =>
  new Promise((resolve, reject) => {
    const args = [CLI, "run", "--root", copy.root, "--wrappers", "config/**/*.js", "--out-dir", copy.outDir, "--test-timeout-ms", TEST_TIMEOUT_MS];
    const child = spawn(process.execPath, args, { cwd: copy.outDir, stdio: ["ignore", "pipe", "pipe"] });
    const output = { stdout: "", stderr: "" };
    child.stdout.on("data", (chunk: Buffer) => {
      output.stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output.stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (status) => {
      const reportFile = path.join(copy.outDir, "failwalk.json");
      if (!fs.existsSync(reportFile)) {
        reject(new Error(`failwalk run on ${copy.root} wrote no failwalk.json:\n${output.stderr}`));
        return;
      }
      resolve({ status, ...output, report: JSON.parse(fs.readFileSync(reportFile, "utf8")) as RunReport });
    });
  });

/**
 * The cells of one call site, in plan order.
 *
 * @param params.report - a run's report
 * @param params.site - the site id
 * @returns its cells, empty when the inventory has no such site
 */
export const cellsOf = ({ report, site }: { report: RunReport; site: string }): CellResult[] => report.cells.filter((cell) => cell.site === site);

/**
 * Says what a run reported for one site, for a failure message: each mode's verdict and checks, or that the site is
 * not in the inventory along with the sites that are, in the same file.
 *
 * @param params.report - a run's report
 * @param params.site - the site id
 * @returns one line per cell, or one line naming the inventory's sites in that file
 */
export const describeSite = ({ report, site }: { report: RunReport; site: string }): string => {
  const cells = cellsOf({ report, site });
  if (cells.length > 0) return cells.map((cell) => `  ${cell.mode}: ${cell.verdict}, checks [${cell.checks.join(", ")}]`).join("\n");
  const file = site.split("@")[1]?.split(":")[0] ?? "";
  const siblings = report.inventory.sites.filter((candidate) => candidate.file === file).map(({ id }) => id);
  return `  no call site with that id in the inventory; the sites in ${file} are: ${siblings.join(", ") || "none"}`;
};
