import { MODES, type ModeName } from "./modes";

/** The one (call site, mode) pair a run injects. */
export type Injection = { site: string; mode: ModeName };

/**
 * Reads the injection target from the environment. Throws on a half-set or unknown pair, so a typo cannot pass as a clean run.
 *
 * @param params.env - usually process.env
 * @returns the injection, or null when neither variable is set
 */
export const readInjection = ({ env }: { env: Record<string, string | undefined> }): Injection | null => {
  const site = env.FAILWALK_SITE;
  const mode = env.FAILWALK_MODE;
  if (!site && !mode) return null;
  if (!site || !mode) throw new Error("FAILWALK_SITE and FAILWALK_MODE must be set together. Set both to inject, or neither to trace.");
  if (!(mode in MODES)) throw new Error(`Unknown FAILWALK_MODE "${mode}". Known modes: ${Object.keys(MODES).join(", ")}`);
  return { site, mode: mode as ModeName };
};
