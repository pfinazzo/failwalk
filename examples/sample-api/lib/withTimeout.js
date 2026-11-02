/**
 * Settles with the vendor's answer, or rejects once timeoutMs has passed with no answer.
 * The timer never keeps the process alive, and it is cleared as soon as the answer arrives.
 *
 * @param {Object} params
 * @param {Promise<*>} params.promise - the vendor's pending answer
 * @param {number} params.timeoutMs - how long to wait, in milliseconds
 * @param {string} params.what - names the call for the error message
 * @returns {Promise<*>} the answer
 */
const withTimeout = ({ promise, timeoutMs, what }) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} took longer than ${timeoutMs} ms`)), timeoutMs);
    timer.unref();
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });

/**
 * Gives one vendor method a time limit. The function handed back takes the method's own params.
 *
 * @param {Object} params
 * @param {Function} params.method - the vendor method
 * @param {number} params.timeoutMs - how long one call may take, in milliseconds
 * @param {string} params.what - names the method for the error message
 * @returns {Function} the method with the limit
 */
const timed =
  ({ method, timeoutMs, what }) =>
  (params) =>
    withTimeout({ promise: method(params), timeoutMs, what });

module.exports = { withTimeout, timed };
