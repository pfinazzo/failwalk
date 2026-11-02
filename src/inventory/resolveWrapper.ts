import path from "node:path";

/** Endings Node tries when a require path names no file directly. */
const CANDIDATE_SUFFIXES = ["", ".js", ".cjs", ".mjs", ".ts", ".tsx", "/index.js", "/index.cjs", "/index.ts"];

/**
 * Resolves a relative import source to one of the known wrapper files.
 *
 * @param params.fromFile - absolute path of the file doing the import
 * @param params.source - the string in `require("...")` or `import ... from "..."`
 * @param params.wrapperFiles - absolute paths of every wrapper module
 * @returns the matching wrapper's absolute path, or null when the import is not a wrapper
 */
export const resolveWrapperFile = ({
  fromFile,
  source,
  wrapperFiles,
}: {
  fromFile: string;
  source: string;
  wrapperFiles: ReadonlySet<string>;
}): string | null => {
  if (!source.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), source);
  return CANDIDATE_SUFFIXES.map((suffix) => base + suffix).find((candidate) => wrapperFiles.has(candidate)) ?? null;
};
