const database = require("../config/database");

/**
 * Removes a subscription's local record and reports it archived.
 *
 * The pattern failwalk's `swallowed-catch` check finds: the catch around the delete neither throws nor returns
 * anything, so the caller is told "archived" whether or not the record is gone. If the database refuses the delete:
 * the record stays, the customer sees "archived", and nobody learns the two disagree.
 *
 * @param {Object} params
 * @param {string} params.subscriptionId - vendor subscription id
 * @returns {Promise<{archived: boolean}>} always archived
 */
const archiveSubscriptionSwallowingErrors = async ({ subscriptionId }) => {
  try {
    await database.remove({ path: `subscriptions/${subscriptionId}` });
  } catch {
    // Dropped on purpose: this is the pattern the swallowed-catch check finds.
  }
  return { archived: true };
};

module.exports = { archiveSubscriptionSwallowingErrors };
