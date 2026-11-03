import fs from "node:fs";
import path from "node:path";

/** The file `failwalk init` writes and the bare `failwalk` command reads, in the project root. */
export const CONFIG_FILE = "failwalk.config.json";

/** The Jest config override `failwalk init` writes, in the project root. */
export const OVERRIDE_FILE = "jest.failwalk.config.js";

/** The folder under the project root where every run file goes. */
export const OUTPUT_DIR = ".failwalk";

/** The map page, written in the project root so it is easy to find and to send. */
export const PAGE_FILE = "failwalk-ui.html";

/** What failwalk.config.json holds. Both paths are relative to the project root. */
export type FailwalkConfig = {
  /** Glob for the wrapper modules. */
  wrappers: string;
  /** The Jest config override that loads failwalk's setup file. */
  jestConfig: string;
};

/**
 * Reads failwalk.config.json from a project root.
 *
 * @param params.root - the project folder
 * @returns the config, or null when the file is missing
 */
export const readConfig = ({ root }: { root: string }): FailwalkConfig | null => {
  const file = path.join(root, CONFIG_FILE);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as FailwalkConfig) : null;
};
