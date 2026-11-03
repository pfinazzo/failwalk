import fs from "node:fs";
import path from "node:path";

/** The package file, one folder above the built code. */
const PACKAGE_FILE = path.join(__dirname, "..", "package.json");

/**
 * Reads failwalk's version from its package.json, so the CLI and the package can never disagree.
 *
 * @returns the version string
 */
export const readVersion = (): string => (JSON.parse(fs.readFileSync(PACKAGE_FILE, "utf8")) as { version: string }).version;
