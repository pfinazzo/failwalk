import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TraceSummary } from "../tracer/mergeTraces";
import { loadInventory } from "../tracer/loadInventory";
import { shapeScene, type Report, type Scene } from "./shape";

/**
 * Reads a JSON file when it exists.
 *
 * @param params.file - the path
 * @returns the parsed file, or null when there is no file
 */
const readJsonIfPresent = <T>({ file }: { file: string }): T | null => (fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null);

/**
 * Loads the three files and shapes them into the scene. loadInventory throws, naming the path, when the inventory is missing.
 * With no trace file but a report, the trace inside the report stands in, since `failwalk run` keeps one there.
 *
 * @param params.inventoryFile - the inventory path
 * @param params.traceFile - the merged trace path
 * @param params.reportFile - the run report path
 * @returns the scene
 */
export const loadScene = ({ inventoryFile, traceFile, reportFile }: { inventoryFile: string; traceFile: string; reportFile: string }): Scene => {
  const inventory = loadInventory({ file: inventoryFile });
  const report = readJsonIfPresent<Report & { trace?: TraceSummary }>({ file: reportFile });
  const trace = readJsonIfPresent<TraceSummary>({ file: traceFile }) ?? report?.trace ?? null;
  return shapeScene({ inventory, trace, report });
};

/** The command that opens a file with its default app, per platform. Anything else is treated like Linux. */
const OPENERS: Record<string, (params: { file: string }) => { command: string; args: string[] }> = {
  darwin: ({ file }) => ({ command: "open", args: [file] }),
  win32: ({ file }) => ({ command: "cmd", args: ["/c", "start", "", file] }),
  linux: ({ file }) => ({ command: "xdg-open", args: [file] }),
};

/**
 * Opens a file in the default browser and does not wait for it. The opener runs detached, so the command can exit at once.
 *
 * @param params.file - the file to open
 * @param params.platform - usually process.platform
 */
export const openInBrowser = ({ file, platform }: { file: string; platform: string }): void => {
  const { command, args } = (OPENERS[platform] || OPENERS.linux)({ file: path.resolve(file) });
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
};
