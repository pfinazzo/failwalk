const billing = require("../config/billing");

/** How many times to ask the vendor before giving up. */
const MAX_ATTEMPTS = 3;

/**
 * Lists a customer's invoices, asking the vendor up to MAX_ATTEMPTS times.
 * A retry loop is the one place this app awaits inside a loop: each attempt must finish before the next starts.
 *
 * @param {Object} params
 * @param {string} params.customerId - vendor customer id
 * @returns {Promise<Object[]>} the invoices
 */
const listInvoices = async ({ customerId }) => {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await billing.invoices.list({ customerId });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Failed to list invoices for ${customerId} after ${MAX_ATTEMPTS} attempts: ${lastError.message}`, {
    cause: lastError,
  });
};

module.exports = { listInvoices };
