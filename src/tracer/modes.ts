/** The one failure mode v1 injects. The spec's full table arrives with the plan stage. */
export type ModeName = "500";

/** What the injected method knows about the call it is replacing. */
export type ModeContext = { wrapper: string; method: string; siteId: string; mode: ModeName };

/** A vendor-shaped HTTP error. It carries the status under the field names common SDKs use: `status`, `statusCode`, `http_status_code` and `response.status`. */
export type VendorError = Error & {
  status: number;
  statusCode: number;
  http_status_code: number;
  code: string;
  response: { status: number; data: { message: string } };
  failwalk: { siteId: string; mode: ModeName };
};

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
    name: "FailwalkInjectedError",
    status,
    statusCode: status,
    http_status_code: status,
    code: `HTTP_${status}`,
    response: { status, data: { message } },
    failwalk: { siteId, mode },
  });
};

/** What each mode makes the injected call return instead of calling the vendor. */
export const MODES: Record<ModeName, (context: ModeContext) => unknown> = {
  "500": (context) => Promise.reject(vendorError({ ...context, status: 500 })),
};
