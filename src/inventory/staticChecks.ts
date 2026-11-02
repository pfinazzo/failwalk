import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { calleeNameOf, descendantsOf, functionNameOf, propertyNameOf } from "./ast";
import type { CallKind } from "./types";

/** The five checks, by name. Each one marks a pattern that a passing test can hide. */
export type CheckName = "retry-without-idempotency-key" | "no-timeout" | "swallowed-catch" | "retry-without-backoff" | "unawaited-call";

/** A shape the checks saw but cannot judge. The report says so instead of guessing. */
export type Note = "retry-shape-unknown";

/** What every check reads: the call, the function around it, and two facts the inventory already knows. */
export type CheckInput = {
  /** The call expression's path: its node, its parents and its scope. */
  callPath: NodePath<t.CallExpression | t.OptionalCallExpression>;
  /** The function the call sits in, or null for a call at module level. */
  enclosing: NodePath<t.Function> | null;
  kind: CallKind;
  /** True when the wrapper's source for this method names a timeout, so the call is covered without passing one. */
  wrapperHasTimeout: boolean;
};

/** One row of the check table: a sentence on what it finds, and the pure test. */
export type StaticCheck = { what: string; fires: (params: { input: CheckInput }) => boolean };

/** Helpers whose callback is a retry: the call inside the callback runs again after a failure. */
const RETRY_HELPERS: readonly string[] = ["retry", "pRetry", "withRetry", "retryAsync"];

/** Property and header names that make a retried write safe to repeat. */
const IDEMPOTENCY_KEYS: readonly string[] = ["idempotency_key", "idempotencyKey", "Idempotency-Key"];

/** Identifiers that mean a call has a time limit, in the call's arguments or in the wrapper's source. */
export const TIMEOUT_NAMES: readonly string[] = ["timeout", "timeoutMs", "timeout_ms"];

/** Words in the name of a call that waits: `sleep(ms)`, `delay(ms)`, `waitFor(...)`, `setTimeout(resolve, ms)`. */
const DELAY_WORDS: readonly string[] = ["sleep", "delay", "wait", "setTimeout"];

/** Parents that only pass the call's value along. The walk looks through them to the parent that decides. */
const TRANSPARENT_PARENTS: ReadonlySet<string> = new Set([
  "ConditionalExpression",
  "LogicalExpression",
  "SequenceExpression",
  "ParenthesizedExpression",
  "UnaryExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
]);

/** One step up the tree: an ancestor, and the node the walk came up from. */
type Step = { ancestor: NodePath; child: t.Node };

/** Where a retried call sits: the loop body or the retry helper's callback body, which is searched for a delay. */
type RetryScope = { body: t.Node };

/**
 * Lists the call's ancestors from the nearest out, each with the child the walk came up from.
 *
 * @param params.callPath - the call's path
 * @returns the steps, nearest first
 */
const stepsUp = ({ callPath }: { callPath: NodePath }): Step[] => {
  const ancestry = callPath.getAncestry();
  return ancestry.slice(1).map((ancestor, index) => ({ ancestor, child: ancestry[index].node }));
};

/**
 * Whether a function is the callback of a retry helper: an argument of a call named `retry`, `pRetry`, `withRetry` or `retryAsync`.
 *
 * @param params.fnPath - the function's path
 * @returns true for a retry callback
 */
const isRetryCallback = ({ fnPath }: { fnPath: NodePath<t.Function> }): boolean => {
  const { parent } = fnPath;
  if (!t.isCallExpression(parent) && !t.isOptionalCallExpression(parent)) return false;
  return parent.arguments.includes(fnPath.node as t.Expression) && RETRY_HELPERS.includes(calleeNameOf({ callee: parent.callee }) ?? "");
};

/** The two retry shapes v1 detects. A step that matches one gives the scope to search for a delay. */
const RETRY_SHAPES: readonly ((params: Step) => RetryScope | null)[] = [
  ({ ancestor, child }) => {
    if (!ancestor.isLoop()) return null;
    const { body } = ancestor.node;
    const hasCatch = descendantsOf({ node: body }).some((node) => t.isTryStatement(node) && Boolean(node.handler));
    return child === body && hasCatch ? { body } : null;
  },
  ({ ancestor }) => (ancestor.isFunction() && isRetryCallback({ fnPath: ancestor }) ? { body: ancestor.node.body } : null),
];

/**
 * Finds the retry a call sits in: the body of a `for`, `while` or `do` loop that contains a `try`/`catch`,
 * or the callback passed to a retry helper. The nearest one wins.
 * A function that calls itself from a `catch` is a retry too, but this does not see it; `notesFor` reports that shape.
 *
 * @param params.callPath - the call's path
 * @returns the retry scope, or null when the call is not retried
 */
export const retryScopeOf = ({ callPath }: { callPath: NodePath }): RetryScope | null =>
  stepsUp({ callPath }).flatMap((step) => RETRY_SHAPES.flatMap((shape) => shape(step) ?? []))[0] ?? null;

/**
 * Whether any argument of a call carries a property with one of the given names, at any depth: `{ timeout: 5 }`,
 * `{ headers: { "Idempotency-Key": key } }`, or a shorthand `{ idempotencyKey }`.
 *
 * @param params.args - the call's arguments
 * @param params.names - property names to look for
 * @returns true when one is found
 */
const argumentsCarry = ({ args, names }: { args: readonly t.Node[]; names: readonly string[] }): boolean =>
  args
    .flatMap((arg) => [arg, ...descendantsOf({ node: arg })])
    .some((node) => t.isObjectProperty(node) && names.includes(propertyNameOf({ key: node.key, computed: node.computed }) ?? ""));

/**
 * Whether a call or `new` is a wait: its callee's name contains sleep, delay, wait or setTimeout, in any letter case.
 *
 * @param params.node - any node
 * @returns true for a delaying call
 */
const isDelayCall = ({ node }: { node: t.Node }): boolean => {
  if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node) && !t.isNewExpression(node)) return false;
  const name = (calleeNameOf({ callee: node.callee }) ?? "").toLowerCase();
  return DELAY_WORDS.some((word) => name.includes(word.toLowerCase()));
};

/**
 * Whether a retry scope waits between attempts: it awaits something that is, or contains, a delaying call.
 * `await sleep(ms)` and `await new Promise((resolve) => setTimeout(resolve, ms))` both count. An await inside a nested function does not.
 *
 * @param params.body - the loop body or callback body
 * @returns true when a wait is awaited
 */
const awaitsDelay = ({ body }: { body: t.Node }): boolean =>
  descendantsOf({ node: body, crossFunctions: false }).some(
    (node) => t.isAwaitExpression(node) && [node.argument, ...descendantsOf({ node: node.argument })].some((inner) => isDelayCall({ node: inner })),
  );

/**
 * Finds the `try` whose block the call sits in. A call inside a `catch` or `finally` is not inside that try.
 *
 * @param params.callPath - the call's path
 * @returns the try statement, or null
 */
const enclosingTryOf = ({ callPath }: { callPath: NodePath }): t.TryStatement | null => {
  const step = stepsUp({ callPath }).find(({ ancestor, child }) => ancestor.isTryStatement() && child === ancestor.node.block);
  return step ? (step.ancestor.node as t.TryStatement) : null;
};

/** Each way a `catch` block passes the failure on. A catch with none of these swallows it. */
const HANDLING_SHAPES: readonly ((params: { node: t.Node }) => boolean)[] = [
  ({ node }) => t.isThrowStatement(node),
  ({ node }) => t.isReturnStatement(node) && Boolean(node.argument),
  ({ node }) => t.isCallExpression(node) && t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.object, { name: "Promise" }) && t.isIdentifier(node.callee.property, { name: "reject" }),
];

/**
 * Whether a `catch` block swallows the failure: no `throw`, no `return` with a value, no `Promise.reject`, outside nested functions.
 *
 * @param params.handler - the catch clause
 * @returns true when nothing passes the failure on
 */
const catchSwallows = ({ handler }: { handler: t.CatchClause }): boolean =>
  !descendantsOf({ node: handler.body, crossFunctions: false }).some((node) => HANDLING_SHAPES.some((shape) => shape({ node })));

/** Each parent shape that keeps the call's promise, by parent type. A parent not listed here drops it. */
const KEEPING_PARENTS: Record<string, (params: { parent: t.Node; node: t.Node }) => boolean> = {
  AwaitExpression: () => true,
  YieldExpression: () => true,
  ReturnStatement: () => true,
  ArrowFunctionExpression: ({ parent, node }) => (parent as t.ArrowFunctionExpression).body === node,
  VariableDeclarator: ({ parent, node }) => (parent as t.VariableDeclarator).init === node,
  AssignmentExpression: ({ parent, node }) => (parent as t.AssignmentExpression).right === node,
  CallExpression: ({ parent, node }) => (parent as t.CallExpression).arguments.includes(node as t.Expression),
  OptionalCallExpression: ({ parent, node }) => (parent as t.OptionalCallExpression).arguments.includes(node as t.Expression),
  NewExpression: ({ parent, node }) => (parent as t.NewExpression).arguments.includes(node as t.Expression),
  ArrayExpression: () => true,
  ObjectProperty: ({ parent, node }) => (parent as t.ObjectProperty).value === node,
  MemberExpression: ({ parent, node }) => {
    const member = parent as t.MemberExpression;
    return member.object === node && ["then", "catch"].includes(propertyNameOf({ key: member.property, computed: member.computed }) ?? "");
  },
  OptionalMemberExpression: ({ parent, node }) => {
    const member = parent as t.OptionalMemberExpression;
    return member.object === node && ["then", "catch"].includes(propertyNameOf({ key: member.property, computed: member.computed }) ?? "");
  },
};

/** The default for a parent type not in the table: the promise is dropped. */
const DROPS_PROMISE = (): boolean => false;

/**
 * Whether a call's promise goes nowhere: not awaited, returned, assigned, passed as an argument or an array element,
 * nor followed by `.then` or `.catch`. A conditional, logical or `void` parent is looked through.
 *
 * @param params.callPath - the call's path
 * @returns true for a dropped promise
 */
const isUnawaited = ({ callPath }: { callPath: NodePath }): boolean => {
  const step = stepsUp({ callPath }).find(({ ancestor }) => !TRANSPARENT_PARENTS.has(ancestor.node.type));
  if (!step) return true;
  return !(KEEPING_PARENTS[step.ancestor.node.type] || DROPS_PROMISE)({ parent: step.ancestor.node, node: step.child });
};

/**
 * The check table. One row per check, each a pure function of the call and its surroundings. Adding a check means adding a row.
 */
export const STATIC_CHECKS: Record<CheckName, StaticCheck> = {
  "retry-without-idempotency-key": {
    what: "A write is retried and no attempt carries an idempotency key, so a lost answer becomes a second write.",
    fires: ({ input }) =>
      input.kind === "write" &&
      retryScopeOf({ callPath: input.callPath }) !== null &&
      !argumentsCarry({ args: input.callPath.node.arguments, names: IDEMPOTENCY_KEYS }),
  },
  "no-timeout": {
    what: "Neither the call nor the wrapper names a timeout, so a vendor that never answers holds the request forever.",
    fires: ({ input }) => !input.wrapperHasTimeout && !argumentsCarry({ args: input.callPath.node.arguments, names: TIMEOUT_NAMES }),
  },
  "swallowed-catch": {
    what: "The catch around the call neither throws, returns a value nor rejects, so the caller never learns the call failed.",
    fires: ({ input }) => {
      const tryNode = enclosingTryOf({ callPath: input.callPath });
      return tryNode?.handler ? catchSwallows({ handler: tryNode.handler }) : false;
    },
  },
  "retry-without-backoff": {
    what: "The call is retried with no wait between attempts, so a struggling vendor is hit again at once.",
    fires: ({ input }) => {
      const scope = retryScopeOf({ callPath: input.callPath });
      return scope !== null && !awaitsDelay({ body: scope.body });
    },
  },
  "unawaited-call": {
    what: "The call's promise is dropped, so its failure surfaces nowhere and its success is assumed.",
    fires: ({ input }) => isUnawaited({ callPath: input.callPath }),
  },
};

/** The check names in table order, which is the order they are reported in. */
export const CHECK_NAMES: readonly CheckName[] = ["retry-without-idempotency-key", "no-timeout", "swallowed-catch", "retry-without-backoff", "unawaited-call"];

/**
 * Runs every check on one call site. Pure.
 *
 * @param params.input - the call and its surroundings
 * @returns the names of the checks that fired, in table order
 */
export const checksFor = ({ input }: { input: CheckInput }): CheckName[] => CHECK_NAMES.filter((name) => STATIC_CHECKS[name].fires({ input }));

/**
 * Whether a function calls itself from inside one of its `catch` blocks: a retry the checks cannot judge.
 *
 * @param params.fnPath - the function's path
 * @returns true for that shape
 */
const recursesFromCatch = ({ fnPath }: { fnPath: NodePath<t.Function> }): boolean => {
  const name = functionNameOf({ fnPath });
  if (name === null) return false;
  return descendantsOf({ node: fnPath.node.body })
    .filter((node): node is t.CatchClause => t.isCatchClause(node))
    .some((clause) => descendantsOf({ node: clause.body }).some((node) => t.isCallExpression(node) && t.isIdentifier(node.callee, { name })));
};

/**
 * The notes for one call site: `retry-shape-unknown` when its enclosing function retries by calling itself from a `catch`.
 *
 * @param params.enclosing - the function the call sits in, or null
 * @returns the notes, empty when there are none
 */
export const notesFor = ({ enclosing }: { enclosing: NodePath<t.Function> | null }): Note[] =>
  enclosing && recursesFromCatch({ fnPath: enclosing }) ? ["retry-shape-unknown"] : [];
