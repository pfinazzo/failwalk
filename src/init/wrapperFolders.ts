import fs from "node:fs";
import path from "node:path";

/** Where projects usually keep their wrapper modules, in the order `failwalk init` tries them. The first folder that exists wins. */
export const WRAPPER_FOLDERS: readonly string[] = [
  "config",
  "src/config",
  "lib/config",
  "clients",
  "src/clients",
  "services",
  "src/services",
  "wrappers",
  "src/wrappers",
];

/**
 * The glob that covers every JavaScript and TypeScript file under a folder.
 *
 * @param params.folder - a folder relative to the project root
 * @returns the glob, relative to the project root
 */
export const globForFolder = ({ folder }: { folder: string }): string => `${folder}/**/*.{js,ts}`;

/**
 * Picks the wrapper folder for a project: the first entry of WRAPPER_FOLDERS that exists under the root.
 *
 * @param params.root - the project folder
 * @returns the folder and its glob, or null when none of the folders exists
 */
export const pickWrapperFolder = ({ root }: { root: string }): { folder: string; glob: string } | null => {
  const folder = WRAPPER_FOLDERS.find((candidate) => fs.statSync(path.join(root, candidate), { throwIfNoEntry: false })?.isDirectory());
  return folder ? { folder, glob: globForFolder({ folder }) } : null;
};
