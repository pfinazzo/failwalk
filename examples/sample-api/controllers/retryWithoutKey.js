const billing = require("../config/billing");
const { sleep } = require("../lib/sleep");

/** How many times to ask the vendor before giving up. */
const MAX_ATTEMPTS = 3;

/** How long to wait after the first failed attempt, in milliseconds. Each later wait is one step longer. */
const BACKOFF_STEP_MS = 10;

/**
 * Creates a subscription at the billing vendor, asking again after a failure, with a growing wait between attempts.
 *
 * The pattern failwalk's `retry-without-idempotency-key` check finds: the create is a write, it is retried, and no
 * attempt carries an idempotency key. If the first attempt reached the vendor but its answer was lost on the way
 * back: the second attempt creates a second subscription, and the customer is billed twice.
 *
 * @param {Object} params
 * @param {string} params.customerId - vendor customer id
 * @param {string} params.planId - plan to subscribe to
 * @returns {Promise<Object>} the new subscription
 */
const createSignupRetryingWithoutKey = async ({ customerId, planId }) => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await billing.subscriptions.create({ customerId, planId });
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`Failed to create a subscription for ${customerId} after ${MAX_ATTEMPTS} attempts: ${error.message}`, { cause: error });
      }
      await sleep({ ms: BACKOFF_STEP_MS * attempt });
    }
  }
  return null;
};

module.exports = { createSignupRetryingWithoutKey };
