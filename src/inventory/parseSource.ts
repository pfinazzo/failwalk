import { parse, type ParserPlugin } from "@babel/parser";
import * as t from "@babel/types";
import path from "node:path";

/** Babel syntax plugins by file extension. Plain JavaScript gets JSX only. */
const PLUGINS_BY_EXTENSION: Record<string, ParserPlugin[]> = {
  ".ts": ["typescript"],
  ".mts": ["typescript"],
  ".cts": ["typescript"],
  ".tsx": ["typescript", "jsx"],
};
const DEFAULT_PLUGINS: ParserPlugin[] = ["jsx"];

/**
 * Parses one source file the way the inventory reads every file: modules or scripts, TypeScript by extension.
 * Throws when Babel cannot parse the code.
 *
 * @param params.code - the file's source text
 * @param params.file - the file's path, which picks the syntax plugins
 * @returns the parsed file
 */
export const parseSource = ({ code, file }: { code: string; file: string }): t.File =>
  parse(code, {
    sourceType: "unambiguous",
    plugins: PLUGINS_BY_EXTENSION[path.extname(file)] || DEFAULT_PLUGINS,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
  });
