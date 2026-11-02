import type { CheckName, Note } from "./staticChecks";

/** Whether a wrapper method only reads from the dependency or can change something. */
export type CallKind = "read" | "write";

/** One place in the source code that calls a wrapper method. */
export type CallSite = {
  /** `<wrapper>.<method>@<file>:<line>`, unique per call site. */
  id: string;
  /** Path relative to the scanned root, with forward slashes. */
  file: string;
  /** Line of the method name in the call, which is the line a stack trace reports. */
  line: number;
  /** Wrapper module name, from its path under the wrapper folder: `billing`, `database`. */
  wrapper: string;
  /** Full member chain after the wrapper, for example `subscriptions.retrieve`. */
  method: string;
  kind: CallKind;
  /** The static checks that fired on this call, in table order. Empty when none did. */
  checks: CheckName[];
  /** Shapes the checks saw but cannot judge. Empty when there are none. */
  notes: Note[];
};

/** A source file the parser could not read. Reported, never hidden. */
export type ScanError = { file: string; message: string };

/** The full result of one inventory scan. The tracer reads this file. */
export type Inventory = {
  root: string;
  wrappers: string;
  /** Folder the wrapper names are relative to, relative to root. */
  wrapperBase: string;
  /** Wrapper module files, relative to root. */
  wrapperFiles: string[];
  sites: CallSite[];
  errors: ScanError[];
};
