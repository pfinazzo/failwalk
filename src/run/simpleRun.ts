import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, OUTPUT_DIR, PAGE_FILE, readConfig } from "../init/config";
import { loadScene, openInBrowser } from "../ui/load";
import { renderPage } from "../ui/render";
import { runWalk, type RunReport } from "./runCommand";

/** What the bare `failwalk` command takes. Undefined means "use failwalk.config.json". */
export type SimpleRunOptions = {
  root: string;
  wrappers?: string;
  concurrency: number;
  minCoverage: number;
  testTimeoutMs: number;
  /** Open the map page once written. */
  open: boolean;
  /** Progress lines go here while cells run. */
  log: (params: { line: string }) => void;
};

/**
 * The bare `failwalk` command: reads failwalk.config.json, runs the whole walk with every file under .failwalk/, writes
 * the map page in the root and opens it. Throws, saying to run `failwalk init`, when the config is missing.
 *
 * @param params - see SimpleRunOptions
 * @returns the report, the exit code and where the page is
 */
export const runSimple = async ({ root, wrappers, concurrency, minCoverage, testTimeoutMs, open, log }: SimpleRunOptions): Promise<{ report: RunReport; exitCode: number; pageFile: string }> => {
  const absoluteRoot = path.resolve(root);
  const config = readConfig({ root: absoluteRoot });
  if (!config) throw new Error(`no ${CONFIG_FILE} in ${absoluteRoot}. Run "failwalk init" first.`);
  const outDir = path.join(absoluteRoot, OUTPUT_DIR);
  const { report, exitCode } = await runWalk({
    root: absoluteRoot,
    wrappers: wrappers ?? config.wrappers,
    config: config.jestConfig,
    outDir,
    workDir: outDir,
    concurrency,
    minCoverage,
    testTimeoutMs,
    log,
  });
  const scene = loadScene({
    inventoryFile: path.join(outDir, "failwalk-inventory.json"),
    traceFile: path.join(outDir, "failwalk-trace.json"),
    reportFile: path.join(outDir, "failwalk.json"),
  });
  const pageFile = path.join(absoluteRoot, PAGE_FILE);
  fs.writeFileSync(pageFile, renderPage({ scene }));
  if (open) openInBrowser({ file: pageFile, platform: process.platform });
  return { report, exitCode, pageFile };
};
