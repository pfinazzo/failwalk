const billing = require("../config/billing");
const database = require("../config/database");

/**
 * Copies a subscription from the billing vendor into the database.
 *
 * @param {Object} params
 * @param {string} params.subscriptionId - vendor subscription id
 * @returns {Promise<Object|null>} the subscription, or null when the vendor has none
 */
const syncSubscription = async ({ subscriptionId }) => {
  const subscription = await billing.subscriptions.retrieve({ subscriptionId });
  if (!subscription) return null;
  await database.update({
    path: `subscriptions/${subscriptionId}`,
    value: { status: subscription.status, plan: subscription.plan_id },
  });
  return subscription;
};

/**
 * Cancels a subscription at the vendor, then locally.
 *
 * If the vendor call fails: the local record is marked `cancel_pending` so a later job can retry,
 * and that status is returned. The caller does not see the vendor error.
 *
 * @param {Object} params
 * @param {string} params.subscriptionId - vendor subscription id
 * @returns {Promise<{status: string}>} the status now stored locally
 */
const cancelSubscription = async ({ subscriptionId }) => {
  try {
    const cancelled = await billing.subscriptions.cancel({ subscriptionId });
    await database.update({ path: `subscriptions/${subscriptionId}`, value: { status: cancelled.status } });
    return { status: cancelled.status };
  } catch (error) {
    await database.update({ path: `subscriptions/${subscriptionId}`, value: { status: "cancel_pending", reason: error.message } });
    return { status: "cancel_pending" };
  }
};

/**
 * Records that someone viewed a subscription. The write is not awaited so the response does not wait
 * for the database. When the write fails, nothing catches it: the process sees an unhandled rejection.
 *
 * @param {Object} params
 * @param {string} params.subscriptionId - vendor subscription id
 * @returns {{recorded: boolean}} always recorded
 */
const recordView = ({ subscriptionId }) => {
  database.update({ path: `subscriptions/${subscriptionId}`, value: { viewed_at: Date.now() } });
  return { recorded: true };
};

module.exports = { syncSubscription, cancelSubscription, recordView };
