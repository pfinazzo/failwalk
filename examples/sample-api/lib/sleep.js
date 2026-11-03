/**
 * Resolves after a wait.
 *
 * @param {Object} params
 * @param {number} params.ms - how long to wait, in milliseconds
 * @returns {Promise<void>} resolves once the wait is over
 */
const sleep = ({ ms }) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { sleep };
