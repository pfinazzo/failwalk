import type { CallKind } from "./types";

/**
 * Verbs that only read from a dependency. A method counts as a read when its last
 * segment is one of these, or starts with one followed by a capital letter (`getUser`).
 */
export const READ_VERBS: readonly string[] = [
  "get",
  "retrieve",
  "list",
  "find",
  "fetch",
  "query",
  "exists",
  "read",
  "search",
  "count",
  "head",
  "describe",
  "load",
  "lookup",
  "verify",
  "check",
  "has",
  "is",
  "once",
  "select",
  "download",
  "status",
];

/**
 * Says whether a read verb matches a method name: equal to it, or a prefix ending at a capital letter or underscore.
 *
 * @param params.verb - one entry of READ_VERBS
 * @param params.name - the last segment of a method chain
 * @returns true when the name reads as that verb
 */
const verbMatches = ({ verb, name }: { verb: string; name: string }): boolean =>
  name === verb || (name.startsWith(verb) && /[A-Z_]/.test(name.charAt(verb.length)));

/**
 * Classifies a method chain like `subscriptions.retrieve` by its last segment.
 * Unknown names default to `write`, the safer assumption.
 *
 * @param params.method - full member chain after the wrapper
 * @returns `read` or `write`
 */
export const kindOfMethod = ({ method }: { method: string }): CallKind => {
  const name = method.split(".").at(-1) ?? method;
  return READ_VERBS.some((verb) => verbMatches({ verb, name })) ? "read" : "write";
};
