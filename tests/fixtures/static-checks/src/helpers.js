/** Stand-ins for the waits and retry helpers the cases call. None of this runs. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const delay = ({ ms }) => sleep(ms);
const pRetry = async (fn) => fn();
const withRetry = async (fn) => fn();

module.exports = { sleep, delay, pRetry, withRetry };
