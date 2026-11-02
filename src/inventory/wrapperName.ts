import path from "node:path";

/** Characters that make a glob segment a pattern rather than a plain folder name. */
const GLOB_CHARS = /[*?[\]{}()!]/;

/** File extensions stripped from a wrapper path to get its name. */
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/;

/**
 * Returns the plain folder prefix of a glob: everything before the first wildcard segment.
 * `config/**\/*.js` gives `config`. A bare file pattern like `*.js` gives an empty string.
 *
 * @param params.pattern - a glob relative to the root
 * @returns the folder prefix, relative to the root, with forward slashes
 */
export const globBase = ({ pattern }: { pattern: string }): string => {
  const segments = pattern.split("/");
  const firstWild = segments.findIndex((segment) => GLOB_CHARS.test(segment));
  const plain = firstWild === -1 ? segments.slice(0, -1) : segments.slice(0, firstWild);
  return plain.join("/");
};

/**
 * Names a wrapper from its path under the wrapper folder.
 * `config/billing.js` gives `billing`. `config/database/index.js` gives `database`.
 * `config/database/queries.js` gives `database/queries`.
 *
 * @param params.file - wrapper file, relative to the root
 * @param params.wrapperBase - wrapper folder, relative to the root
 * @returns the wrapper name
 */
export const wrapperNameOf = ({ file, wrapperBase }: { file: string; wrapperBase: string }): string => {
  const relative = path.posix.relative(wrapperBase, file);
  const withoutExtension = relative.replace(SOURCE_EXTENSION, "");
  return withoutExtension.replace(/\/index$/, "") || path.posix.basename(wrapperBase);
};
