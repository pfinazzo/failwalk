import path from "node:path";
import type { CallSite } from "../inventory/types";
import type { Frame } from "./stack";

/** One wrapper call the tracer saw, matched to the inventory or not. */
export type Reach = {
  /** The inventory id, or `UNINVENTORIED:<wrapper>.<method>@<file>:<line>`. */
  id: string;
  inventoried: boolean;
  wrapper: string;
  method: string;
  file: string;
  line: number;
};

/** Inventory sites grouped by `<file>:<line>`. */
export type SiteIndex = Record<string, CallSite[]>;

/** The file recorded when no frame outside the tracer and wrappers could be found. */
const UNKNOWN_FILE = "(unknown)";

/**
 * Groups inventory sites by file and line, for matching stack frames.
 *
 * @param params.sites - the inventory
 * @returns `<file>:<line>` to the sites on that line
 */
export const indexSites = ({ sites }: { sites: readonly CallSite[] }): SiteIndex =>
  sites.reduce<SiteIndex>((acc, site) => {
    const key = `${site.file}:${site.line}`;
    return { ...acc, [key]: [...(acc[key] || []), site] };
  }, {});

/**
 * Picks the inventory site for a frame. On a line with several sites, the one with the same wrapper and method wins.
 *
 * @param params.candidates - sites on that file and line
 * @param params.wrapper - wrapper that was called
 * @param params.method - method that was called
 * @returns the matching site, or null
 */
const matchSite = ({ candidates, wrapper, method }: { candidates: readonly CallSite[]; wrapper: string; method: string }): CallSite | null =>
  candidates.find((site) => site.wrapper === wrapper && site.method === method) ??
  (candidates.length === 1 ? candidates[0] : null);

/**
 * Turns a caller frame into a reach record: the inventory id when file and line match, else an UNINVENTORIED record.
 *
 * @param params.frame - the caller frame, or null when none was found
 * @param params.root - the inventory root, which frame paths are made relative to
 * @param params.wrapper - wrapper that was called
 * @param params.method - method that was called
 * @param params.index - inventory sites by file and line
 * @returns the reach record
 */
export const reachFor = ({
  frame,
  root,
  wrapper,
  method,
  index,
}: {
  frame: Frame | null;
  root: string;
  wrapper: string;
  method: string;
  index: SiteIndex;
}): Reach => {
  const file = frame ? path.relative(root, frame.file).split(path.sep).join("/") : UNKNOWN_FILE;
  const line = frame?.line ?? 0;
  const site = matchSite({ candidates: index[`${file}:${line}`] || [], wrapper, method });
  if (site) return { id: site.id, inventoried: true, wrapper: site.wrapper, method: site.method, file, line };
  return { id: `UNINVENTORIED:${wrapper}.${method}@${file}:${line}`, inventoried: false, wrapper, method, file, line };
};
