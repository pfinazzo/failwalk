/** A stand-in store whose time limit is set once, at module level, for every method. */

/** The one limit every call shares. */
const options = { timeout: 500 };

/**
 * Writes a record.
 *
 * @param {Object} params
 * @param {string} params.key - record key
 * @returns {Promise<Object>} the options used
 */
const put = async ({ key }) => ({ key, ...options });

module.exports = { put };
