import fs from "node:fs";
import path from "node:path";

/** Where a project's own Jest config comes from: one of its config files, the `jest` field of package.json, or nowhere. */
export type JestBase = { kind: "file"; file: string } | { kind: "package" } | { kind: "none" };

/** Jest's own config file names, in the order Jest looks for them. */
const JEST_CONFIG_FILES: readonly string[] = ["jest.config.js", "jest.config.cjs", "jest.config.mjs"];

/**
 * Reads the `jest` field of the project's package.json, when there is one.
 *
 * @param params.root - the project folder
 * @returns true when package.json exists and has a `jest` field
 */
const hasPackageJestField = ({ root }: { root: string }): boolean => {
  const file = path.join(root, "package.json");
  if (!fs.existsSync(file)) return false;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { jest?: unknown };
  return parsed.jest !== undefined;
};

/**
 * Finds where a project's Jest config lives: a config file first, then the package.json field, else nothing.
 *
 * @param params.root - the project folder
 * @returns the base kind and, for a file, its name
 */
export const findJestBase = ({ root }: { root: string }): JestBase => {
  const file = JEST_CONFIG_FILES.find((candidate) => fs.existsSync(path.join(root, candidate)));
  if (file) return { kind: "file", file };
  return hasPackageJestField({ root }) ? { kind: "package" } : { kind: "none" };
};

/** The line that loads the project's own config, per base kind. An ES module config exports its object as `default`. */
const BASE_LINE: Record<JestBase["kind"], (params: { base: JestBase }) => string> = {
  file: ({ base }) => {
    const file = base.kind === "file" ? base.file : "";
    return file.endsWith(".mjs") ? `const base = require("./${file}").default;` : `const base = require("./${file}");`;
  },
  package: () => `const base = require("./package.json").jest;`,
  none: () => "",
};

/** The export line, per base kind: the project's config with the setup file appended, or the setup file alone. */
const EXPORT_LINE: Record<JestBase["kind"], string> = {
  file: "module.exports = { ...base, setupFilesAfterEnv: [...(base.setupFilesAfterEnv || []), setupFile()] };",
  package: "module.exports = { ...base, setupFilesAfterEnv: [...(base.setupFilesAfterEnv || []), setupFile()] };",
  none: "module.exports = { setupFilesAfterEnv: [setupFile()] };",
};

/** What the override says about the base it loads, per kind, for the terminal. */
export const BASE_DESCRIPTION: Record<JestBase["kind"], (params: { base: JestBase }) => string> = {
  file: ({ base }) => `loads ${base.kind === "file" ? base.file : ""}`,
  package: () => `loads the jest field of package.json`,
  none: () => `holds only the setup file, since this project has no Jest config`,
};

/**
 * The text of jest.failwalk.config.js for a project. The setup file's path is found when Jest loads the override:
 * from FAILWALK_SETUP, which the `failwalk` command sets, else from the failwalk package installed in the project.
 *
 * @param params.base - where the project's own Jest config lives
 * @returns the override's source text
 */
export const renderJestOverride = ({ base }: { base: JestBase }): string =>
  [
    "/**",
    " * Jest config override written by `failwalk init`. Loads this project's own Jest config and adds failwalk's tracer.",
    " * `failwalk` runs the suite with it. To run it by hand:",
    ' *   FAILWALK_SETUP="$(failwalk setup-path)" npx jest --config jest.failwalk.config.js',
    " */",
    ...(BASE_LINE[base.kind]({ base }) ? [BASE_LINE[base.kind]({ base }), ""] : []),
    "/**",
    " * Where failwalk's Jest setup file is. The `failwalk` command sets FAILWALK_SETUP for every run it starts.",
    " * Without it, the file comes from the failwalk package installed in this project.",
    " */",
    "const setupFile = () => {",
    "  if (process.env.FAILWALK_SETUP) return process.env.FAILWALK_SETUP;",
    "  try {",
    '    return require.resolve("failwalk/dist/tracer/setup.js");',
    "  } catch (error) {",
    '    throw new Error("failwalk: cannot find the setup file. Run the suite through `failwalk`, or install failwalk in this project.", { cause: error });',
    "  }",
    "};",
    "",
    EXPORT_LINE[base.kind],
    "",
  ].join("\n");
