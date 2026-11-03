import fs from "node:fs";
import path from "node:path";

/** The lines `failwalk init` adds to a project's .gitignore: the run folder and the map page. */
export const IGNORED_LINES: readonly string[] = [".failwalk/", "failwalk-ui.html"];

/**
 * Adds lines to a project's .gitignore, creating the file when it is missing. A line already there, with or without
 * surrounding spaces, is not added again, so running init twice leaves one copy.
 *
 * @param params.root - the project folder
 * @param params.lines - the lines to make sure are present
 * @returns the lines that were added
 */
export const addGitignoreLines = ({ root, lines }: { root: string; lines: readonly string[] }): string[] => {
  const file = path.join(root, ".gitignore");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const present = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = lines.filter((line) => !present.has(line));
  if (missing.length === 0) return [];
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(file, `${current}${separator}${missing.join("\n")}\n`);
  return missing;
};
