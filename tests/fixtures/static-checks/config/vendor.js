/** A stand-in vendor for the static-check tests. `charge` names its own timeout; `ping` and `getBalance` do not. */

/**
 * Charges an amount, within a time limit the caller may change.
 *
 * @param {Object} params
 * @param {number} params.amount - cents to charge
 * @param {number} params.timeoutMs - how long to wait, in milliseconds
 * @returns {Promise<Object>} the charge
 */
const charge = async ({ amount, timeoutMs = 1000 }) => ({ amount, timeoutMs });

/**
 * Checks the vendor is up.
 *
 * @returns {Promise<string>} "pong"
 */
const ping = async () => "pong";

/**
 * Reads the balance.
 *
 * @returns {Promise<number>} cents
 */
const getBalance = async () => 0;

module.exports = { charge, ping, getBalance };
