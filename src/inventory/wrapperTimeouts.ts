import traverse, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { functionNameOf } from "./ast";
import { parseSource } from "./parseSource";
import { TIMEOUT_NAMES } from "./staticChecks";

/**
 * What a wrapper module says about timeouts. A timeout named at module level, outside every function, is a shared
 * limit and covers every method. Otherwise only the methods whose own definition names one are covered.
 */
export type WrapperTimeouts = { moduleLevel: boolean; methods: string[] };

/** The timeouts of a wrapper the inventory could not read: none. */
export const NO_TIMEOUTS: WrapperTimeouts = { moduleLevel: false, methods: [] };

/** Where one timeout identifier was found: at module level, or inside the named top-level function. */
type TimeoutPlace = { moduleLevel: boolean; method: string | null };

/**
 * Says where an identifier sits: outside every function, or inside which top-level function.
 *
 * @param params.nodePath - the identifier's path
 * @returns the place
 */
const placeOf = ({ nodePath }: { nodePath: NodePath }): TimeoutPlace => {
  const outermost = nodePath.getAncestry().filter((ancestor): ancestor is NodePath<t.Function> => ancestor.isFunction()).at(-1);
  return outermost ? { moduleLevel: false, method: functionNameOf({ fnPath: outermost }) } : { moduleLevel: true, method: null };
};

/**
 * Reads where a wrapper module names a timeout: `timeout`, `timeoutMs` or `timeout_ms` as any identifier, a property key included.
 * Throws when Babel cannot parse the file.
 *
 * @param params.code - the wrapper's source text
 * @param params.file - the wrapper's path, which picks the syntax plugins
 * @returns the module-level flag and the names of the methods with their own timeout
 */
export const wrapperTimeoutsOf = ({ code, file }: { code: string; file: string }): WrapperTimeouts => {
  const ast = parseSource({ code, file });
  // Babel's traversal is callback driven, so this local list is the one accumulator here.
  const places: TimeoutPlace[] = [];
  traverse(ast, {
    Identifier: (nodePath: NodePath<t.Identifier>) => {
      if (TIMEOUT_NAMES.includes(nodePath.node.name)) places.push(placeOf({ nodePath }));
    },
  });
  return {
    moduleLevel: places.some(({ moduleLevel }) => moduleLevel),
    methods: [...new Set(places.flatMap(({ method }) => (method === null ? [] : [method])))],
  };
};

/**
 * Whether a wrapper covers one method with a timeout: a module-level one, or one in the method's own definition.
 * The method's definition is found by the last segment of the chain: `retrieve` for `subscriptions.retrieve`.
 *
 * @param params.timeouts - what the wrapper says
 * @param params.method - the member chain after the wrapper
 * @returns true when the method has a time limit
 */
export const hasTimeout = ({ timeouts, method }: { timeouts: WrapperTimeouts; method: string }): boolean =>
  timeouts.moduleLevel || timeouts.methods.includes(method.split(".").at(-1) ?? method);
