import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, OVERRIDE_FILE, type FailwalkConfig } from "./config";
import { addGitignoreLines, IGNORED_LINES } from "./gitignore";
import { BASE_DESCRIPTION, findJestBase, renderJestOverride } from "./jestOverride";
import { pickWrapperFolder, WRAPPER_FOLDERS } from "./wrapperFolders";

/** What `failwalk init` takes. */
export type InitOptions = {
  root: string;
  /** The wrappers glob, or undefined to pick a folder from WRAPPER_FOLDERS. */
  wrappers?: string;
  /** Replace failwalk.config.json and jest.failwalk.config.js when they exist. */
  force: boolean;
};

/** What `failwalk init` did, one line per file, for the terminal. */
export type InitResult = { config: FailwalkConfig; lines: string[] };

/**
 * Decides the wrappers glob: the one given, else the first folder from the lookup list that exists. Throws, naming
 * --wrappers, when nothing was given and no folder exists, because a guess would inventory nothing.
 *
 * @param params.root - the project folder
 * @param params.wrappers - the glob from the command line, or undefined
 * @returns the glob and the line that says where it came from
 */
const chooseWrappers = ({ root, wrappers }: { root: string; wrappers?: string }): { glob: string; line: string } => {
  if (wrappers) return { glob: wrappers, line: `wrappers: ${wrappers} (from --wrappers)` };
  const picked = pickWrapperFolder({ root });
  if (!picked) {
    throw new Error(`no wrapper folder found in ${root}. Looked for ${WRAPPER_FOLDERS.join(", ")}. Pass --wrappers <glob> to say where your wrapper modules are.`);
  }
  return { glob: picked.glob, line: `wrappers: ${picked.glob} (${picked.folder} is the first folder of ${WRAPPER_FOLDERS.join(", ")} that exists here; pass --wrappers to choose another)` };
};

/**
 * Throws when a file init would write already exists and --force was not given, naming every such file.
 *
 * @param params.root - the project folder
 * @param params.force - whether existing files may be replaced
 */
const refuseToOverwrite = ({ root, force }: { root: string; force: boolean }): void => {
  if (force) return;
  const existing = [CONFIG_FILE, OVERRIDE_FILE].filter((file) => fs.existsSync(path.join(root, file)));
  if (existing.length === 0) return;
  throw new Error(`${existing.join(" and ")} already exist${existing.length === 1 ? "s" : ""} in ${root}. --force replaces ${existing.length === 1 ? "it" : "them"}.`);
};

/**
 * Sets a project up for the bare `failwalk` command: writes failwalk.config.json and jest.failwalk.config.js in the root
 * and adds failwalk's output files to .gitignore. Refuses to replace either file unless `force` is set.
 *
 * @param params - see InitOptions
 * @returns the config written and the lines to print
 */
export const initProject = ({ root, wrappers, force }: InitOptions): InitResult => {
  const absoluteRoot = path.resolve(root);
  refuseToOverwrite({ root: absoluteRoot, force });
  const chosen = chooseWrappers({ root: absoluteRoot, wrappers });
  const config: FailwalkConfig = { wrappers: chosen.glob, jestConfig: OVERRIDE_FILE };
  const base = findJestBase({ root: absoluteRoot });
  fs.writeFileSync(path.join(absoluteRoot, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(path.join(absoluteRoot, OVERRIDE_FILE), renderJestOverride({ base }));
  const added = addGitignoreLines({ root: absoluteRoot, lines: IGNORED_LINES });
  const gitignoreLine = added.length > 0 ? `added ${added.join(" and ")} to .gitignore` : `.gitignore already lists ${IGNORED_LINES.join(" and ")}`;
  return {
    config,
    lines: [chosen.line, `wrote ${CONFIG_FILE}`, `wrote ${OVERRIDE_FILE} (${BASE_DESCRIPTION[base.kind]({ base })})`, gitignoreLine, "Next: run failwalk"],
  };
};
