import traverse, { type NodePath, type Scope } from "@babel/traverse";
import * as t from "@babel/types";
import path from "node:path";
import { kindOfMethod } from "./kinds";
import { parseSource } from "./parseSource";
import { resolveWrapperFile } from "./resolveWrapper";
import { checksFor, notesFor } from "./staticChecks";
import { wrapperNameOf } from "./wrapperName";
import { hasTimeout, NO_TIMEOUTS, type WrapperTimeouts } from "./wrapperTimeouts";
import type { CallSite } from "./types";

/** Where a local name came from: which wrapper, and which export of it (null for the whole module). */
type WrapperBinding = { wrapper: string; member: string | null };

/** A local identifier that holds a wrapper or one of its exports. */
type BindingEntry = { local: t.Identifier; binding: WrapperBinding };

/** Looks up the wrapper name for an import source, or null when the source is not a wrapper. */
type WrapperLookup = (params: { source: string }) => string | null;

/** Nodes that read a wrapper member chain: `a.b.c`, with or without `?.`. */
type PlainMember = (t.MemberExpression | t.OptionalMemberExpression) & { property: t.Identifier };

/**
 * Reads the module path out of a `require("...")` call.
 *
 * @param params.node - any AST node
 * @returns the string argument, or null when the node is not a plain require call
 */
const requireSource = ({ node }: { node: t.Node | null | undefined }): string | null => {
  if (!t.isCallExpression(node)) return null;
  if (!t.isIdentifier(node.callee, { name: "require" })) return null;
  const [argument] = node.arguments;
  return node.arguments.length === 1 && t.isStringLiteral(argument) ? argument.value : null;
};

/**
 * Returns the node when it is a non-computed member access with an identifier property, like `a.b` or `a?.b`.
 *
 * @param params.node - any AST node, or nothing
 * @returns the node typed as a plain member, or null for `a[b]` and everything else
 */
const asPlainMember = ({ node }: { node: t.Node | null | undefined }): PlainMember | null =>
  (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) && !node.computed && t.isIdentifier(node.property)
    ? (node as PlainMember)
    : null;

/**
 * Lists the names pulled out of a destructuring pattern: `{ a, b: c }` gives a→a and b→c.
 *
 * @param params.pattern - the object pattern on the left of an assignment
 * @returns one entry per property, with the exported name and the local identifier
 */
const patternEntries = ({ pattern }: { pattern: t.ObjectPattern }): { member: string; local: t.Identifier }[] =>
  pattern.properties.flatMap((property) => {
    if (!t.isObjectProperty(property) || !t.isIdentifier(property.key)) return [];
    const local = t.isAssignmentPattern(property.value) ? property.value.left : property.value;
    return t.isIdentifier(local) ? [{ member: property.key.name, local }] : [];
  });

/**
 * Finds the wrapper bindings made by one `const ... = require(...)` declarator.
 * Handles `X = require(p)`, `{ a, b: c } = require(p)` and `X = require(p).a`.
 *
 * @param params.declarator - the variable declarator node
 * @param params.wrapperOf - resolves an import source to a wrapper name
 * @returns the bindings it creates, empty when it is not a wrapper require
 */
const declaratorBindings = ({
  declarator,
  wrapperOf,
}: {
  declarator: t.VariableDeclarator;
  wrapperOf: WrapperLookup;
}): BindingEntry[] => {
  const { id, init } = declarator;
  const direct = requireSource({ node: init });
  const directWrapper = direct ? wrapperOf({ source: direct }) : null;
  if (directWrapper && t.isIdentifier(id)) return [{ local: id, binding: { wrapper: directWrapper, member: null } }];
  if (directWrapper && t.isObjectPattern(id)) {
    return patternEntries({ pattern: id }).map(({ member, local }) => ({
      local,
      binding: { wrapper: directWrapper, member },
    }));
  }
  const member = asPlainMember({ node: init });
  if (!member || !t.isIdentifier(id)) return [];
  const viaMember = requireSource({ node: member.object });
  const memberWrapper = viaMember ? wrapperOf({ source: viaMember }) : null;
  return memberWrapper ? [{ local: id, binding: { wrapper: memberWrapper, member: member.property.name } }] : [];
};

/**
 * Finds the wrapper bindings made by one `import` statement.
 *
 * @param params.declaration - the import declaration node
 * @param params.wrapperOf - resolves an import source to a wrapper name
 * @returns one binding per specifier, empty when the source is not a wrapper
 */
const importBindings = ({
  declaration,
  wrapperOf,
}: {
  declaration: t.ImportDeclaration;
  wrapperOf: WrapperLookup;
}): BindingEntry[] => {
  const wrapper = wrapperOf({ source: declaration.source.value });
  if (!wrapper) return [];
  return declaration.specifiers.map((specifier) => ({
    local: specifier.local,
    binding: {
      wrapper,
      member: t.isImportSpecifier(specifier)
        ? t.isIdentifier(specifier.imported)
          ? specifier.imported.name
          : specifier.imported.value
        : null,
    },
  }));
};

/**
 * Walks every import and require in a file and maps each local identifier to its wrapper.
 *
 * @param params.ast - the parsed file
 * @param params.wrapperOf - resolves an import source to a wrapper name
 * @returns a map keyed by the declaring identifier node, which Babel's scope lookup hands back
 */
const collectBindings = ({ ast, wrapperOf }: { ast: t.File; wrapperOf: WrapperLookup }): Map<t.Identifier, WrapperBinding> => {
  // Babel's traversal is callback driven, so this local list is the one accumulator here.
  const entries: BindingEntry[] = [];
  traverse(ast, {
    VariableDeclarator: (nodePath: NodePath<t.VariableDeclarator>) => {
      entries.push(...declaratorBindings({ declarator: nodePath.node, wrapperOf }));
    },
    ImportDeclaration: (nodePath: NodePath<t.ImportDeclaration>) => {
      entries.push(...importBindings({ declaration: nodePath.node, wrapperOf }));
    },
  });
  return new Map(entries.map(({ local, binding }) => [local, binding]));
};

/**
 * Splits a callee like `wrapper.database.update` into its root node and the member names after it.
 *
 * @param params.node - the callee, or a node inside it during recursion
 * @param params.members - member names collected so far
 * @returns the root expression and the member chain in source order
 */
const calleeChain = ({ node, members = [] }: { node: t.Node; members?: string[] }): { root: t.Node; members: string[] } => {
  const member = asPlainMember({ node });
  return member ? calleeChain({ node: member.object, members: [member.property.name, ...members] }) : { root: node, members };
};

/**
 * Finds which wrapper a callee's root refers to, through the scope's binding or a direct require.
 *
 * @param params.root - the leftmost expression of the callee
 * @param params.scope - the scope of the call, for shadowing-aware lookup
 * @param params.bindings - wrapper bindings collected from imports and requires
 * @param params.wrapperOf - resolves an import source to a wrapper name
 * @returns the wrapper binding, or null when the call does not reach a wrapper
 */
const bindingOfRoot = ({
  root,
  scope,
  bindings,
  wrapperOf,
}: {
  root: t.Node;
  scope: Scope;
  bindings: Map<t.Identifier, WrapperBinding>;
  wrapperOf: WrapperLookup;
}): WrapperBinding | null => {
  if (t.isIdentifier(root)) {
    const binding = scope.getBinding(root.name);
    return binding ? bindings.get(binding.identifier) ?? null : null;
  }
  const source = requireSource({ node: root });
  const wrapper = source ? wrapperOf({ source }) : null;
  return wrapper ? { wrapper, member: null } : null;
};

/**
 * The line a stack trace reports for a call: the line of the method name for `a.b()`, else the call's first line.
 *
 * @param params.callee - the callee expression
 * @returns a 1-based line number
 */
const callLine = ({ callee }: { callee: t.Node }): number =>
  asPlainMember({ node: callee })?.property.loc?.start.line ?? callee.loc?.start.line ?? 0;

/**
 * Builds the call-site record for one call expression, or null when it does not call a wrapper.
 *
 * @param params.nodePath - the call expression's path
 * @param params.file - path relative to root, with forward slashes
 * @param params.bindings - wrapper bindings collected from imports and requires
 * @param params.wrapperOf - resolves an import source to a wrapper name
 * @param params.wrapperTimeouts - what each wrapper says about timeouts, by wrapper name
 * @returns a call site, or null
 */
const siteOfCall = ({
  nodePath,
  file,
  bindings,
  wrapperOf,
  wrapperTimeouts,
}: {
  nodePath: NodePath<t.CallExpression | t.OptionalCallExpression>;
  file: string;
  bindings: Map<t.Identifier, WrapperBinding>;
  wrapperOf: WrapperLookup;
  wrapperTimeouts: Readonly<Record<string, WrapperTimeouts>>;
}): CallSite | null => {
  const { callee } = nodePath.node;
  const { root, members } = calleeChain({ node: callee });
  const binding = bindingOfRoot({ root, scope: nodePath.scope, bindings, wrapperOf });
  if (!binding) return null;
  const method = [binding.member, ...members].filter((segment) => segment !== null).join(".") || "default";
  const line = callLine({ callee });
  const kind = kindOfMethod({ method });
  const enclosing = nodePath.getFunctionParent();
  const wrapperHasTimeout = hasTimeout({ timeouts: wrapperTimeouts[binding.wrapper] ?? NO_TIMEOUTS, method });
  return {
    id: `${binding.wrapper}.${method}@${file}:${line}`,
    file,
    line,
    wrapper: binding.wrapper,
    method,
    kind,
    checks: checksFor({ input: { callPath: nodePath, enclosing, kind, wrapperHasTimeout } }),
    notes: notesFor({ enclosing }),
  };
};

/**
 * Converts an absolute path to a root-relative path with forward slashes.
 *
 * @param params.file - absolute path
 * @param params.root - absolute root
 * @returns the relative path as it appears in ids
 */
export const toRelativeFile = ({ file, root }: { file: string; root: string }): string =>
  path.relative(root, file).split(path.sep).join("/");

/**
 * Finds every call site in one source file that calls a wrapper method. Pure: parses the given code and returns records.
 * Throws when Babel cannot parse the file.
 *
 * @param params.code - the file's source text
 * @param params.file - absolute path of the file, used to resolve relative imports
 * @param params.root - absolute path the inventory is relative to
 * @param params.wrapperFiles - absolute paths of every wrapper module
 * @param params.wrapperBase - wrapper folder relative to root, which wrapper names are relative to
 * @param params.wrapperTimeouts - what each wrapper says about timeouts, by wrapper name; a wrapper not listed has none
 * @returns call sites in source order
 */
export const findCallSites = ({
  code,
  file,
  root,
  wrapperFiles,
  wrapperBase,
  wrapperTimeouts = {},
}: {
  code: string;
  file: string;
  root: string;
  wrapperFiles: ReadonlySet<string>;
  wrapperBase: string;
  wrapperTimeouts?: Readonly<Record<string, WrapperTimeouts>>;
}): CallSite[] => {
  const relativeFile = toRelativeFile({ file, root });
  /**
   * Names the wrapper an import source points at, or null when it is not a wrapper.
   *
   * @param params.source - the string in a require or import
   * @returns the wrapper name, or null
   */
  const wrapperOf: WrapperLookup = ({ source }) => {
    const wrapperFile = resolveWrapperFile({ fromFile: file, source, wrapperFiles });
    return wrapperFile ? wrapperNameOf({ file: toRelativeFile({ file: wrapperFile, root }), wrapperBase }) : null;
  };
  const ast = parseSource({ code, file });
  const bindings = collectBindings({ ast, wrapperOf });
  // Babel's traversal is callback driven, so this local list is the one accumulator here.
  const sites: CallSite[] = [];
  /**
   * Babel visitor for one call expression. Babel hands the path as a positional argument.
   *
   * @param nodePath - the call expression's path
   */
  const visit = (nodePath: NodePath<t.CallExpression | t.OptionalCallExpression>) => {
    const site = siteOfCall({ nodePath, file: relativeFile, bindings, wrapperOf, wrapperTimeouts });
    if (site) sites.push(site);
  };
  traverse(ast, { CallExpression: visit, OptionalCallExpression: visit });
  return sites;
};
