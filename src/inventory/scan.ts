import fg from "fast-glob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { findCallSites, toRelativeFile } from "./findCallSites";
import { globBase } from "./wrapperName";
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
 * Reads and scans one source file. A parse failure becomes an error record instead of stopping the whole scan.
 *
 * @param params.file - absolute path of the source file
 * @param params.root - absolute root
 * @param params.wrapperFiles - absolute paths of every wrapper module
 * @param params.wrapperBase - wrapper folder relative to root
 * @returns the file's sites, or the error that stopped them
 */
const scanFile = async ({
  file,
  root,
  wrapperFiles,
  wrapperBase,
}: {
  file: string;
  root: string;
  wrapperFiles: ReadonlySet<string>;
  wrapperBase: string;
}): Promise<FileResult> => {
  const code = await fs.readFile(file, "utf8");
  try {
    return { sites: findCallSites({ code, file, root, wrapperFiles, wrapperBase }), error: null };
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
  const sourceFiles = await fg(SOURCE_GLOB, { cwd: absoluteRoot, absolute: true, ignore: [...ignore] });
  const results = await Promise.all(
    sourceFiles.map((file) => scanFile({ file, root: absoluteRoot, wrapperFiles: wrapperFileSet, wrapperBase })),
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
 * Formats the inventory summary printed to stderr after a scan.
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
  const errorRows = inventory.errors.map(({ file, message }) => `  could not parse ${file}: ${message}`);
  const errorHeader = inventory.errors.length ? [`${inventory.errors.length} files could not be parsed:`] : [];
  return [header, ...rows, ...errorHeader, ...errorRows].join("\n");
};
