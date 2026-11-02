const { get } = require("../config/database");
const mailer = require("../config/mailer");

/**
 * Emails a receipt for a subscription. No test calls this, so failwalk reports its call sites as unreached.
 *
 * @param {Object} params
 * @param {string} params.subscriptionId - vendor subscription id
 * @param {string} params.email - where to send the receipt
 * @returns {Promise<Object|null>} the queued message, or null when the subscription is not stored
 */
const sendReceipt = async ({ subscriptionId, email }) => {
  const record = await get({ path: `subscriptions/${subscriptionId}` });
  if (!record) return null;
  return mailer.send({ to: email, subject: `Receipt for ${subscriptionId}`, body: `Your plan: ${record.plan}` });
};

module.exports = { sendReceipt };
