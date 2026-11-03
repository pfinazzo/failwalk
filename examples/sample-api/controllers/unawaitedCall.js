const database = require("../config/database");

/**
 * Records that someone logged in to a subscription. The write is not awaited, so the response does not wait for the database.
 *
 * The pattern failwalk's `unawaited-call` check finds: nothing holds the write's promise. If the write fails: the
 * process sees an unhandled rejection and the caller sees "recorded". If the write never settles: nothing notices at all.
 *
 * @param {Object} params
 * @param {string} params.subscriptionId - vendor subscription id
 * @returns {{recorded: boolean}} always recorded
 */
const recordLoginWithoutAwait = ({ subscriptionId }) => {
  database.update({ path: `logins/${subscriptionId}`, value: { last_login_at: Date.now() } });
  return { recorded: true };
};

module.exports = { recordLoginWithoutAwait };
