import type { CallDecision } from "./wrapExports";

/** The failure modes failwalk can inject. `duplicate` from the spec is a v2 mode for inbound webhooks and is not here. */
export type ModeName = "timeout" | "dropped" | "500" | "429" | "malformed" | "partial";

/** What the injected method knows about the call it is replacing. */
export type ModeContext = { wrapper: string; method: string; siteId: string; mode: ModeName };

/** One row of the failure-mode table: what the injected call does, in words and in code. */
export type Mode = {
  /** One line for the README and the terminal, saying what the call does instead of reaching the vendor. */
  what: string;
  /** Builds the tracer's decision for one injected call. */
  inject: (context: ModeContext) => CallDecision;
};

/** A vendor-shaped HTTP error. It carries the status under the field names common SDKs use: `status`, `statusCode`, `http_status_code` and `response.status`. */
export type VendorError = Error & {
  status: number;
  statusCode: number;
  http_status_code: number;
  code: string;
  response: { status: number; data: { message: string } };
  failwalk: { siteId: string; mode: ModeName };
};

/** The error a dropped connection raises: a plain Error with the socket error code on it. */
export type DroppedError = Error & { code: "ECONNRESET"; syscall: string; failwalk: { siteId: string; mode: ModeName } };

/** The name every injected error carries, so a stack trace says who threw it. */
const INJECTED_ERROR_NAME = "FailwalkInjectedError";

/**
 * Builds the error a vendor would hand back for an HTTP failure, with the site that produced it attached.
 *
 * @param params.status - HTTP status code
 * @param params.wrapper - wrapper name, so the message says which vendor failed
 * @param params.method - wrapper method
 * @param params.siteId - the inventory id being injected
 * @param params.mode - the mode name
 * @returns an Error with status fields on it
 */
export const vendorError = ({ status, wrapper, method, siteId, mode }: ModeContext & { status: number }): VendorError => {
  const message = `${wrapper}.${method} failed with HTTP ${status} (injected by failwalk at ${siteId})`;
  return Object.assign(new Error(message), {
    name: INJECTED_ERROR_NAME,
    status,
    statusCode: status,
    http_status_code: status,
    code: `HTTP_${status}`,
    response: { status, data: { message } },
    failwalk: { siteId, mode },
  });
};

/**
 * Builds the error a connection reset raises: `code` is `ECONNRESET`, the way Node's socket errors spell it.
 *
 * @param params.wrapper - wrapper name
 * @param params.method - wrapper method
 * @param params.siteId - the inventory id being injected
 * @param params.mode - the mode name
 * @returns an Error with the socket error code on it
 */
export const droppedError = ({ wrapper, method, siteId, mode }: ModeContext): DroppedError =>
  Object.assign(new Error(`${wrapper}.${method} connection reset (injected by failwalk at ${siteId})`), {
    name: INJECTED_ERROR_NAME,
    code: "ECONNRESET" as const,
    syscall: "read",
    failwalk: { siteId, mode },
  });

/**
 * Keeps the first half of an array result, rounded down, so a batch of three comes back as one.
 * Any other result becomes `{}`: a partial answer to a single-record call has lost its fields.
 *
 * @param params.result - what the real call resolved with
 * @returns the halved array, or `{}`
 */
export const halveResult = ({ result }: { result: unknown }): unknown =>
  Array.isArray(result) ? result.slice(0, Math.floor(result.length / 2)) : {};

/**
 * Waits for the real call's result, then halves it. Used as the `partial` transform.
 *
 * @param result - the real call's return value, usually a promise. Positional because the Proxy trap hands it over that way.
 * @returns a promise of the halved result
 */
const halveWhenSettled = async (result: unknown): Promise<unknown> => halveResult({ result: await result });

/**
 * A decision that hands back a fixed value instead of calling the vendor.
 *
 * @param params.value - what the call returns
 * @returns the decision
 */
const replaceWith = ({ value }: { value: unknown }): CallDecision => ({ replace: true, value });

/** The failure-mode table, keyed by mode name. Each row says what the injected call does instead of reaching the vendor. */
export const MODES: Record<ModeName, Mode> = {
  timeout: {
    what: "never settles; the test's own timeout ends it",
    inject: () => replaceWith({ value: new Promise(() => {}) }),
  },
  dropped: {
    what: "rejects with an error whose code is ECONNRESET",
    inject: (context) => replaceWith({ value: Promise.reject(droppedError(context)) }),
  },
  "500": {
    what: "rejects with a vendor-shaped error carrying status 500",
    inject: (context) => replaceWith({ value: Promise.reject(vendorError({ ...context, status: 500 })) }),
  },
  "429": {
    what: "rejects with a vendor-shaped error carrying status 429",
    inject: (context) => replaceWith({ value: Promise.reject(vendorError({ ...context, status: 429 })) }),
  },
  malformed: {
    what: "resolves with {}",
    inject: () => replaceWith({ value: Promise.resolve({}) }),
  },
  partial: {
    what: "calls the vendor, then resolves with the first half of an array result, or {} for anything else",
    inject: () => ({ replace: false, transform: halveWhenSettled }),
  },
};

/**
 * Every mode name, in the order the grid shows them. Spelled out rather than read from the table's keys,
 * because JavaScript lists number-like keys such as "500" before the others whatever the source order.
 */
export const MODE_NAMES: readonly ModeName[] = ["timeout", "dropped", "500", "429", "malformed", "partial"];
