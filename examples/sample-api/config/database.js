/** A stand-in database. Records live in memory for the life of the process. */

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

module.exports = { get, update, remove };
