/** A stand-in database. Records live in memory for the life of the process. */
const { timed } = require("../lib/withTimeout");

/** How long one database call may take before the wrapper gives up, in milliseconds. */
const DATABASE_TIMEOUT_MS = 2000;

const records = new Map();

/**
 * Reads one record.
 *
 * @param {Object} params
 * @param {string} params.path - record path
 * @returns {Promise<Object|null>} the record, or null when absent
 */
const get = async ({ path }) => records.get(path) ?? null;

/**
 * Merges fields into one record, creating it when absent.
 *
 * @param {Object} params
 * @param {string} params.path - record path
 * @param {Object} params.value - fields to merge
 * @returns {Promise<Object>} the fields written
 */
const update = async ({ path, value }) => {
  records.set(path, { ...(records.get(path) || {}), ...value });
  return value;
};

/**
 * Deletes one record.
 *
 * @param {Object} params
 * @param {string} params.path - record path
 * @returns {Promise<void>} resolves once the record is gone
 */
const remove = async ({ path }) => {
  records.delete(path);
};

/** Every method goes out with the wrapper's time limit. The stand-in answers at once, so the limit is never hit here. */
module.exports = {
  get: timed({ method: get, timeoutMs: DATABASE_TIMEOUT_MS, what: "database.get" }),
  update: timed({ method: update, timeoutMs: DATABASE_TIMEOUT_MS, what: "database.update" }),
  remove: timed({ method: remove, timeoutMs: DATABASE_TIMEOUT_MS, what: "database.remove" }),
};
