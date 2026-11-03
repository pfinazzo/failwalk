import fg from "fast-glob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { findCallSites, toRelativeFile } from "./findCallSites";
import { globBase, wrapperNameOf } from "./wrapperName";
import { wrapperTimeoutsOf, type WrapperTimeouts } from "./wrapperTimeouts";
import type { CallSite, Inventory, ScanError } from "./types";

/** Source files the inventory parses. */
export const SOURCE_GLOB = "**/*.{js,cjs,mjs,jsx,ts,tsx,mts,cts}";

/** Folders and files that are not product code. Tests are left out: a test calling a wrapper is not a call site to protect. */
export const DEFAULT_IGNORE: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.git/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/test/**",
  "**/tests/**",
  "**/*.d.ts",
];

/** What scanning one file produced: its sites, or the parse error. */
type FileResult = { sites: CallSite[]; error: ScanError | null };

/**
 * Orders sites by file, then line, then id, so output is stable between runs.
 *
 * @param params.a - one site
 * @param params.b - another site
 * @returns a comparator result
 */
const bySourcePosition = ({ a, b }: { a: CallSite; b: CallSite }): number =>
  a.file.localeCompare(b.file) || a.line - b.line || a.id.localeCompare(b.id);

/**
 * Reads one wrapper module and finds where it names a timeout. Throws, naming the file, when the wrapper cannot be parsed:
 * a wrapper the inventory cannot read is a broken setup, not a site to skip.
 *
 * @param params.file - absolute path of the wrapper module
 * @param params.root - absolute root
 * @param params.wrapperBase - wrapper folder relative to root
 * @returns the wrapper's name and what it says about timeouts
 */
const readWrapperTimeouts = async ({ file, root, wrapperBase }: { file: string; root: string; wrapperBase: string }): Promise<{ wrapper: string; timeouts: WrapperTimeouts }> => {
  const code = await fs.readFile(file, "utf8");
  const wrapper = wrapperNameOf({ file: toRelativeFile({ file, root }), wrapperBase });
  try {
    return { wrapper, timeouts: wrapperTimeoutsOf({ code, file }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse the wrapper module ${toRelativeFile({ file, root })}: ${message}`, { cause: error });
  }
};

/**
 * Reads and scans one source file. A parse failure becomes an error record instead of stopping the whole scan.
 *
 * @param params.file - absolute path of the source file
 * @param params.root - absolute root
 * @param params.wrapperFiles - absolute paths of every wrapper module
 * @param params.wrapperBase - wrapper folder relative to root
 * @param params.wrapperTimeouts - what each wrapper says about timeouts, by wrapper name
 * @returns the file's sites, or the error that stopped them
 */
const scanFile = async ({
  file,
  root,
  wrapperFiles,
  wrapperBase,
  wrapperTimeouts,
}: {
  file: string;
  root: string;
  wrapperFiles: ReadonlySet<string>;
  wrapperBase: string;
  wrapperTimeouts: Readonly<Record<string, WrapperTimeouts>>;
}): Promise<FileResult> => {
  const code = await fs.readFile(file, "utf8");
  try {
    return { sites: findCallSites({ code, file, root, wrapperFiles, wrapperBase, wrapperTimeouts }), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { sites: [], error: { file: toRelativeFile({ file, root }), message } };
  }
};

/**
 * Scans a project for every call into a wrapper module. Reads files from disk.
 * Throws when the wrapper glob matches no file, which almost always means a typo in the glob.
 *
 * @param params.root - project folder to scan
 * @param params.wrappers - glob for wrapper modules, relative to root
 * @param params.ignore - globs to skip, relative to root
 * @returns the inventory, with sites in source order
 */
export const scanInventory = async ({
  root,
  wrappers,
  ignore = DEFAULT_IGNORE,
}: {
  root: string;
  wrappers: string;
  ignore?: readonly string[];
}): Promise<Inventory> => {
  const absoluteRoot = path.resolve(root);
  const wrapperFiles = (await fg(wrappers, { cwd: absoluteRoot, absolute: true, ignore: ["**/node_modules/**"] })).sort();
  if (wrapperFiles.length === 0) {
    throw new Error(`No wrapper modules match "${wrappers}" under ${absoluteRoot}. Failwalk needs a wrapper layer to inventory.`);
  }
  const wrapperBase = globBase({ pattern: wrappers });
  const wrapperFileSet = new Set(wrapperFiles);
  const timeoutEntries = await Promise.all(wrapperFiles.map((file) => readWrapperTimeouts({ file, root: absoluteRoot, wrapperBase })));
  const wrapperTimeouts = timeoutEntries.reduce<Record<string, WrapperTimeouts>>((acc, { wrapper, timeouts }) => ({ ...acc, [wrapper]: timeouts }), {});
  const sourceFiles = await fg(SOURCE_GLOB, { cwd: absoluteRoot, absolute: true, ignore: [...ignore] });
  const results = await Promise.all(
    sourceFiles.map((file) => scanFile({ file, root: absoluteRoot, wrapperFiles: wrapperFileSet, wrapperBase, wrapperTimeouts })),
  );
  const sites = results.flatMap(({ sites: fileSites }) => fileSites).sort((a, b) => bySourcePosition({ a, b }));
  const errors = results.flatMap(({ error }) => (error ? [error] : []));
  return {
    root: absoluteRoot,
    wrappers,
    wrapperBase,
    wrapperFiles: wrapperFiles.map((file) => toRelativeFile({ file, root: absoluteRoot })),
    sites,
    errors,
  };
};

/**
 * Counts call sites per wrapper.
 *
 * @param params.sites - inventory records
 * @returns wrapper name to count
 */
export const countByWrapper = ({ sites }: { sites: readonly CallSite[] }): Record<string, number> =>
  sites.reduce<Record<string, number>>((acc, { wrapper }) => ({ ...acc, [wrapper]: (acc[wrapper] || 0) + 1 }), {});

/**
 * Lists one line per fired check or note across the inventory: the name, then the site id, in inventory order.
 *
 * @param params.sites - inventory records
 * @param params.field - which list of each record to read
 * @returns the lines
 */
const markRows = ({ sites, field }: { sites: readonly CallSite[]; field: "checks" | "notes" }): string[] =>
  sites.flatMap((site) => site[field].map((name) => `  ${name.padEnd(30)} ${site.id}`));

/**
 * Formats the inventory summary printed to stderr after a scan: the counts, then one line per fired check, one per note, and the parse errors.
 *
 * @param params.inventory - a finished scan
 * @returns multi-line text
 */
export const formatInventorySummary = ({ inventory }: { inventory: Inventory }): string => {
  const counts = countByWrapper({ sites: inventory.sites });
  const files = new Set(inventory.sites.map(({ file }) => file)).size;
  const header = `failwalk inventory: ${inventory.sites.length} call sites in ${files} files, ${Object.keys(counts).length} of ${inventory.wrapperFiles.length} wrappers used`;
  const rows = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([wrapper, count]) => `  ${wrapper.padEnd(28)} ${String(count).padStart(5)}`);
  const checkRows = markRows({ sites: inventory.sites, field: "checks" });
  const checkHeader = checkRows.length ? [`${checkRows.length} static checks fired:`] : [];
  const noteRows = markRows({ sites: inventory.sites, field: "notes" });
  const noteHeader = noteRows.length ? [`${noteRows.length} notes:`] : [];
  const errorRows = inventory.errors.map(({ file, message }) => `  could not parse ${file}: ${message}`);
  const errorHeader = inventory.errors.length ? [`${inventory.errors.length} files could not be parsed:`] : [];
  return [header, ...rows, ...checkHeader, ...checkRows, ...noteHeader, ...noteRows, ...errorHeader, ...errorRows].join("\n");
};
