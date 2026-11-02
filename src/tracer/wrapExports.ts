/** What the tracer decides for one call: let the real method run, or hand back a replacement value. */
export type CallDecision = { replace: false } | { replace: true; value: unknown };

/** Called synchronously inside every wrapped method, so the stack still holds the caller. */
export type OnCall = (params: { method: string }) => CallDecision;

/** Any callable, as the Proxy traps need it typed. */
type AnyFunction = (...args: unknown[]) => unknown;

/** How many member levels deep to wrap: `wrapper.a.b.c.d` and no further. */
const MAX_DEPTH = 4;

/** Proxy to the real object behind it, so a method's `this` is the real object and private fields keep working. */
const realTargets = new WeakMap<object, object>();

/** Per object, the wrapped value for each property, so `wrapper.database === wrapper.database` stays true. */
const wrappedProperties = new WeakMap<object, Map<string, unknown>>();

/**
 * A property that is both non-writable and non-configurable must be returned unchanged, or the Proxy throws.
 *
 * @param params.target - the real object
 * @param params.property - property name
 * @returns true when the property cannot be wrapped
 */
const isFrozenProperty = ({ target, property }: { target: object; property: string }): boolean => {
  const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
  return descriptor !== undefined && descriptor.writable === false && descriptor.configurable === false;
};

/**
 * Builds the `get` trap shared by object and function proxies: nested values come back wrapped, once each.
 * The returned trap takes `(target, property)` positionally because that is the signature the Proxy API calls it with.
 *
 * @param params.methodPath - member names from the module root to this value
 * @param params.onCall - the tracer's per-call hook
 * @returns a Proxy get trap
 */
const getTrap =
  ({ methodPath, onCall }: { methodPath: readonly string[]; onCall: OnCall }) =>
  /**
   * Reads one property of the real object and returns it wrapped.
   *
   * @param target - the real object
   * @param property - the property being read
   * @returns the wrapped value
   */
  (target: object, property: string | symbol): unknown => {
    const inner = Reflect.get(target, property, target);
    if (typeof property === "symbol" || isFrozenProperty({ target, property })) return inner;
    const cache = wrappedProperties.get(target) ?? new Map<string, unknown>();
    wrappedProperties.set(target, cache);
    if (cache.has(property) && cache.get(property) !== undefined) return cache.get(property);
    const wrapped = wrapExports({ value: inner, methodPath: [...methodPath, property], onCall });
    cache.set(property, wrapped);
    return wrapped;
  };

/**
 * Wraps a function so every call passes through `onCall` first.
 *
 * @param params.fn - the real function
 * @param params.methodPath - member names from the module root to this function
 * @param params.onCall - the tracer's per-call hook
 * @returns a Proxy that calls the real function unless `onCall` replaces the result
 */
const wrapFunction = ({ fn, methodPath, onCall }: { fn: AnyFunction; methodPath: readonly string[]; onCall: OnCall }): AnyFunction => {
  /**
   * Proxy `apply` trap, called positionally by the Proxy API: asks the tracer, then calls the real function with the real `this`.
   *
   * @param target - the real function
   * @param thisArg - the receiver, often one of our proxies
   * @param args - the call's arguments
   * @returns the replacement value, or whatever the real function returns
   */
  const apply = (target: AnyFunction, thisArg: unknown, args: unknown[]): unknown => {
    const decision = onCall({ method: methodPath.join(".") || "default" });
    if (decision.replace) return decision.value;
    const realThis = typeof thisArg === "object" && thisArg !== null ? realTargets.get(thisArg) ?? thisArg : thisArg;
    return Reflect.apply(target, realThis, args);
  };
  /**
   * Proxy `construct` trap, called positionally by the Proxy API: `new Wrapper()` passes through unrecorded.
   *
   * @param target - the real constructor
   * @param args - constructor arguments
   * @param newTarget - the constructor `new` was called on
   * @returns the constructed object
   */
  const construct = (target: AnyFunction, args: unknown[], newTarget: AnyFunction): object =>
    Reflect.construct(target, args, newTarget) as object;
  const proxy = new Proxy<AnyFunction>(fn, { get: getTrap({ methodPath, onCall }), apply, construct });
  realTargets.set(proxy, fn);
  return proxy;
};

/**
 * Wraps a module's exports so every function on it, up to MAX_DEPTH members deep, reports its calls to `onCall`.
 * Returns a Proxy. The real exports object is never changed.
 *
 * @param params.value - the exports, or a nested value during recursion
 * @param params.methodPath - member names from the module root to this value
 * @param params.onCall - the tracer's per-call hook
 * @returns the wrapped value, or the value itself when it is not a function or object
 */
export const wrapExports = ({
  value,
  methodPath = [],
  onCall,
}: {
  value: unknown;
  methodPath?: readonly string[];
  onCall: OnCall;
}): unknown => {
  if (methodPath.length > MAX_DEPTH) return value;
  if (typeof value === "function") return wrapFunction({ fn: value as AnyFunction, methodPath, onCall });
  if (value === null || typeof value !== "object") return value;
  const proxy = new Proxy(value, { get: getTrap({ methodPath, onCall }) });
  realTargets.set(proxy, value);
  return proxy;
};
