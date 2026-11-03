const billing = require("../config/billing");

/** How many times to ask the vendor before giving up. */
const MAX_ATTEMPTS = 3;

/**
 * Reads a subscription's status from the billing vendor, asking again at once after a failure.
 *
 * The pattern failwalk's `retry-without-backoff` check finds: the loop retries with no wait between attempts.
 * If the vendor is rate limiting or recovering from an outage: every caller hits it three times in a row, which
 * keeps it down longer. The catch rethrows on the last attempt, so it does not swallow the failure.
 *
 * @param {Object} params
 * @param {string} params.subscriptionId - vendor subscription id
 * @returns {Promise<{status: string}|null>} the status, or null when the vendor has no such subscription
 */
const readStatusRetryingWithoutBackoff = async ({ subscriptionId }) => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const subscription = await billing.subscriptions.retrieve({ subscriptionId });
      return subscription ? { status: subscription.status } : null;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`Failed to read subscription ${subscriptionId} after ${MAX_ATTEMPTS} attempts: ${error.message}`, { cause: error });
      }
    }
  }
  return null;
};

module.exports = { readStatusRetryingWithoutBackoff };
