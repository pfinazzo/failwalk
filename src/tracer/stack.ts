import path from "node:path";

/** One line of a stack trace that names a file. */
export type Frame = { file: string; line: number; column: number };

/** Matches `(/abs/file.js:12:5)` or a bare `/abs/file.js:12:5` at the end of a stack line. */
const FRAME_LOCATION = /\(?((?:\/|[A-Za-z]:[\\/])[^()\n]*?):(\d+):(\d+)\)?$/;

/** How many frames to keep. Deep call chains through wrappers need more than V8's default of 10. */
const STACK_DEPTH = 50;

/**
 * Captures the current stack as text. Raises V8's frame limit for the capture, then puts it back.
 *
 * @returns the stack string, without the leading "Error" line
 */
export const captureStack = (): string => {
  const previousLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = STACK_DEPTH;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = previousLimit;
  return stack;
};

/**
 * Parses a stack string into frames. Lines with no file, like `at new Promise (<anonymous>)`, are left out.
 *
 * @param params.stack - a V8 stack string
 * @returns frames in call order, innermost first
 */
export const parseStack = ({ stack }: { stack: string }): Frame[] =>
  stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .flatMap((line) => {
      const match = FRAME_LOCATION.exec(line);
      return match ? [{ file: match[1], line: Number(match[2]), column: Number(match[3]) }] : [];
    });

/** Frames that are not the caller: dependencies, Node itself, the tracer, and the wrapper modules. */
const SKIP_RULES: readonly ((params: { frame: Frame; wrapperFiles: ReadonlySet<string>; selfDirs: readonly string[] }) => boolean)[] = [
  ({ frame }) => frame.file.includes(`${path.sep}node_modules${path.sep}`),
  ({ frame }) => frame.file.startsWith("node:"),
  ({ frame, selfDirs }) => selfDirs.some((dir) => frame.file.startsWith(dir + path.sep)),
  ({ frame, wrapperFiles }) => wrapperFiles.has(frame.file),
];

/**
 * The tracer's own folders: the built `dist` and, because source maps turn built frames back into
 * `src/*.ts` frames, the `src` folder beside it.
 *
 * @param params.distDir - the folder of the built tracer, usually `__dirname` of setup.js
 * @returns absolute folders whose frames are never the caller
 */
export const tracerDirs = ({ distDir }: { distDir: string }): string[] => {
  const packageRoot = path.resolve(distDir, "..", "..");
  return [path.join(packageRoot, "dist"), path.join(packageRoot, "src")];
};

/**
 * Picks the frame that called the wrapper: the innermost frame outside node_modules, the tracer, and the wrapper files.
 *
 * @param params.frames - parsed frames, innermost first
 * @param params.wrapperFiles - absolute paths of the wrapper modules
 * @param params.selfDirs - the tracer's own folders, from tracerDirs
 * @returns the caller frame, or null when every frame was skipped
 */
export const callerFrame = ({
  frames,
  wrapperFiles,
  selfDirs,
}: {
  frames: readonly Frame[];
  wrapperFiles: ReadonlySet<string>;
  selfDirs: readonly string[];
}): Frame | null => frames.find((frame) => !SKIP_RULES.some((skip) => skip({ frame, wrapperFiles, selfDirs }))) ?? null;
