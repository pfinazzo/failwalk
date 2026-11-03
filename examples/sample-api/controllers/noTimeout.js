const mailer = require("../config/mailer");

/**
 * Emails a welcome message.
 *
 * The pattern failwalk's `no-timeout` check finds: the mailer wrapper has no time limit and this call passes none.
 * If the mail vendor accepts the connection and never answers: the request waits for as long as the vendor does,
 * and every request behind it waits too.
 *
 * @param {Object} params
 * @param {string} params.email - where to send the welcome
 * @returns {Promise<Object>} the queued message
 */
const sendWelcomeWithoutTimeout = async ({ email }) => {
  const message = await mailer.send({ to: email, subject: "Welcome", body: "Thanks for signing up." });
  return message;
};

module.exports = { sendWelcomeWithoutTimeout };
