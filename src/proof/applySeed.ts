import type { CheckName } from "../inventory/staticChecks";

/** The three bugs the proof plants, named after the check that must find each one. */
export type SeedName = "swallowed-catch" | "retry-without-idempotency-key" | "no-timeout";

/**
 * One planted bug: an exact edit to one sample-app file, and the finding failwalk must report once it is made.
 * `before` occurs exactly once in the clean file. `after` keeps the call on the same line, so `site` names the same
 * line before and after the edit.
 */
export type Seed = {
  name: SeedName;
  /** The file to edit, relative to the sample app's root. */
  file: string;
  /** The exact text to replace. It occurs once in the clean file. */
  before: string;
  /** The text that plants the bug. */
  after: string;
  /** The call-site id failwalk must then report, as `<wrapper>.<method>@<file>:<line>`. */
  site: string;
  /** The check that must fire on that site. */
  check: CheckName;
  /** What the bug does in production, in one sentence. */
  harm: string;
};

/**
 * Returns the file text with the seed's `before` replaced by its `after`. Pure: no files are read or written.
 * Throws when `before` is not found exactly once, naming the seed and the count, because an edit that lands twice or
 * not at all would prove nothing about the one line the seed names.
 *
 * @param params.text - the clean file's text
 * @param params.seed - the seed to apply
 * @returns the seeded text
 */
export const applySeed = ({ text, seed }: { text: string; seed: Seed }): string => {
  const parts = text.split(seed.before);
  const occurrences = parts.length - 1;
  if (occurrences !== 1) {
    throw new Error(`Seed "${seed.name}": its before text occurs ${occurrences} times in ${seed.file}, not once`);
  }
  return parts.join(seed.after);
};
