/** A stand-in email vendor. Messages go into an in-memory outbox. */

const outbox = [];

/**
 * Sends one email.
 *
 * @param {Object} params
 * @param {string} params.to - recipient address
 * @param {string} params.subject - subject line
 * @param {string} params.body - plain-text body
 * @returns {Promise<Object>} the queued message with its id
 */
const send = async ({ to, subject, body }) => {
  const message = { id: `msg_${outbox.length + 1}`, to, subject, body };
  outbox.push(message);
  return message;
};

module.exports = { send };
