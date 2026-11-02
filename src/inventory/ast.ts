import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

/**
 * Lists the child nodes of one node in source order, from Babel's own table of which keys hold children.
 *
 * @param params.node - any AST node
 * @returns its direct children
 */
const childrenOf = ({ node }: { node: t.Node }): t.Node[] =>
  (t.VISITOR_KEYS[node.type] || []).flatMap((key) => {
    const value = (node as unknown as Record<string, unknown>)[key];
    const list = Array.isArray(value) ? value : [value];
    return list.filter((child): child is t.Node => t.isNode(child));
  });

/**
 * Lists every node under one node, depth first, the node itself left out.
 * With `crossFunctions` false, a nested function is listed but nothing inside it is: a `return` or an `await`
 * inside a callback belongs to that callback, not to the code around it.
 *
 * @param params.node - the node to walk under
 * @param params.crossFunctions - whether to walk into nested functions (default true)
 * @returns the nodes under it
 */
export const descendantsOf = ({ node, crossFunctions = true }: { node: t.Node; crossFunctions?: boolean }): t.Node[] =>
  childrenOf({ node }).flatMap((child) =>
    !crossFunctions && t.isFunction(child) ? [child] : [child, ...descendantsOf({ node: child, crossFunctions })],
  );

/**
 * The name of a property key: `a` for `{ a: 1 }` and `{ "a": 1 }`, null for a computed key like `{ [a]: 1 }`.
 *
 * @param params.key - the key node
 * @param params.computed - whether the key is computed
 * @returns the name, or null
 */
export const propertyNameOf = ({ key, computed }: { key: t.Node; computed: boolean }): string | null => {
  if (computed) return null;
  if (t.isIdentifier(key)) return key.name;
  return t.isStringLiteral(key) ? key.value : null;
};

/**
 * The name a call is made by: `retry` for both `retry(...)` and `lib.retry(...)`, null for other callee shapes.
 *
 * @param params.callee - the callee of a call or `new` expression, or the left side of an assignment
 * @returns the name, or null
 */
export const calleeNameOf = ({ callee }: { callee: t.Node }): string | null => {
  if (t.isIdentifier(callee)) return callee.name;
  return t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)
    ? propertyNameOf({ key: callee.property, computed: callee.computed })
    : null;
};

/** Each way a function gets its name, in the order tried. The first rule that finds one wins. */
const NAME_RULES: readonly ((params: { fnPath: NodePath<t.Function> }) => string | null)[] = [
  ({ fnPath }) => ((t.isFunctionDeclaration(fnPath.node) || t.isFunctionExpression(fnPath.node)) && fnPath.node.id ? fnPath.node.id.name : null),
  ({ fnPath }) => (t.isObjectMethod(fnPath.node) ? propertyNameOf({ key: fnPath.node.key, computed: fnPath.node.computed }) : null),
  ({ fnPath }) => (t.isVariableDeclarator(fnPath.parent) && t.isIdentifier(fnPath.parent.id) ? fnPath.parent.id.name : null),
  ({ fnPath }) => (t.isObjectProperty(fnPath.parent) ? propertyNameOf({ key: fnPath.parent.key, computed: fnPath.parent.computed }) : null),
  ({ fnPath }) => (t.isAssignmentExpression(fnPath.parent) ? calleeNameOf({ callee: fnPath.parent.left }) : null),
];

/**
 * The name a function is defined under: `function f() {}`, `const f = () => {}`, `{ f: () => {} }`, `{ f() {} }`
 * or `exports.f = () => {}` all give `f`. An anonymous callback gives null.
 *
 * @param params.fnPath - the function's path
 * @returns the name, or null
 */
export const functionNameOf = ({ fnPath }: { fnPath: NodePath<t.Function> }): string | null =>
  NAME_RULES.map((rule) => rule({ fnPath })).find((name) => name !== null) ?? null;
