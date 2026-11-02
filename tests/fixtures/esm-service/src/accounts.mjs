import { accounts, ping as checkVendor } from "../config/vendor.js";
import * as vendor from "../config/vendor.js";
import queue from "../config/queue.js";

/** Named import, member chain, read verb. */
export const loadAccount = async ({ accountId }) => accounts.get({ accountId });

/** Renamed import called directly. */
export const vendorIsUp = async () => (await checkVendor()) === "pong";

/** Namespace import, member chain, write. */
export const closeAccount = async ({ accountId }) => vendor.accounts.close({ accountId });

/** Default import, member chain, write. */
export const scheduleCleanup = async ({ accountId }) => queue.jobs.enqueue({ name: `cleanup-${accountId}` });

/** A local that shadows the import is not a wrapper call. */
export const notAWrapperCall = async () => {
  const accounts = { get: async () => "local" };
  return accounts.get();
};
