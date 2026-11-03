/** A stand-in billing vendor. Every method answers from memory, without a network. */
const { timed } = require("../lib/withTimeout");

/** How long one vendor call may take before the wrapper gives up, in milliseconds. */
const VENDOR_TIMEOUT_MS = 5000;

const SUBSCRIPTIONS = [
  { id: "sub_1", customer_id: "cus_1", status: "active", plan_id: "premium" },
  { id: "sub_2", customer_id: "cus_2", status: "active", plan_id: "basic" },
];

const INVOICES_BY_CUSTOMER = {
  cus_1: [
    { id: "inv_1", amount: 1200 },
    { id: "inv_2", amount: 1200 },
  ],
};

const subscriptionsById = new Map(SUBSCRIPTIONS.map((subscription) => [subscription.id, subscription]));

/**
 * Returns one subscription.
 *
 * @param {Object} params
 * @param {string} params.subscriptionId - vendor subscription id
 * @returns {Promise<Object|null>} the subscription, or null when the vendor has none
 */
const retrieve = async ({ subscriptionId }) => subscriptionsById.get(subscriptionId) ?? null;

/**
 * Creates a subscription.
 *
 * @param {Object} params
 * @param {string} params.customerId - vendor customer id
 * @param {string} params.planId - plan to subscribe to
 * @returns {Promise<Object>} the new subscription
 */
const create = async ({ customerId, planId }) => {
  const subscription = { id: `sub_${customerId}`, customer_id: customerId, status: "active", plan_id: planId };
  subscriptionsById.set(subscription.id, subscription);
  return subscription;
};

/**
 * Cancels a subscription. Throws when the vendor has no such subscription.
 *
 * @param {Object} params
 * @param {string} params.subscriptionId - vendor subscription id
 * @returns {Promise<Object>} the cancelled subscription
 */
const cancel = async ({ subscriptionId }) => {
  const subscription = subscriptionsById.get(subscriptionId);
  if (!subscription) throw new Error(`No subscription ${subscriptionId} at the billing vendor`);
  const cancelled = { ...subscription, status: "cancelled" };
  subscriptionsById.set(subscriptionId, cancelled);
  return cancelled;
};

/**
 * Lists a customer's invoices.
 *
 * @param {Object} params
 * @param {string} params.customerId - vendor customer id
 * @returns {Promise<Object[]>} the invoices, empty when there are none
 */
const list = async ({ customerId }) => INVOICES_BY_CUSTOMER[customerId] || [];

/** Every method goes out with the wrapper's time limit. The stand-in answers at once, so the limit is never hit here. */
module.exports = {
  subscriptions: {
    retrieve: timed({ method: retrieve, timeoutMs: VENDOR_TIMEOUT_MS, what: "billing.subscriptions.retrieve" }),
    create: timed({ method: create, timeoutMs: VENDOR_TIMEOUT_MS, what: "billing.subscriptions.create" }),
    cancel: timed({ method: cancel, timeoutMs: VENDOR_TIMEOUT_MS, what: "billing.subscriptions.cancel" }),
  },
  invoices: { list: timed({ method: list, timeoutMs: VENDOR_TIMEOUT_MS, what: "billing.invoices.list" }) },
};
