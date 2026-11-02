const billing = require("../config/billing");

/**
 * Creates a subscription at the billing vendor and returns it.
 * Added for step 4: the call is awaited with no timeout of its own, so a `timeout` injection hangs the request,
 * and the test asserts on the vendor's answer, so a `malformed` injection fails that assertion.
 *
 * @param {Object} params
 * @param {string} params.customerId - vendor customer id
 * @param {string} params.planId - plan to subscribe to
 * @returns {Promise<Object>} the new subscription
 */
const createSignup = async ({ customerId, planId }) => billing.subscriptions.create({ customerId, planId });

module.exports = { createSignup };
