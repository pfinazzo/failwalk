const express = require("express");
const { syncSubscription, cancelSubscription, recordView } = require("./controllers/subscriptions");
const { listInvoices } = require("./controllers/invoices");
const { sendReceipt } = require("./controllers/receipts");
const { createSignup } = require("./controllers/signups");
const { createSignupRetryingWithoutKey } = require("./controllers/retryWithoutKey");
const { sendWelcomeWithoutTimeout } = require("./controllers/noTimeout");
const { archiveSubscriptionSwallowingErrors } = require("./controllers/swallowedCatch");
const { readStatusRetryingWithoutBackoff } = require("./controllers/retryWithoutBackoff");
const { recordLoginWithoutAwait } = require("./controllers/unawaitedCall");

const app = express();
app.use(express.json());

app.get("/subscriptions/:id", async (req, res) => {
  try {
    const subscription = await syncSubscription({ subscriptionId: req.params.id });
    if (!subscription) return res.status(404).json({ error: `no subscription ${req.params.id}` });
    return res.json(subscription);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/subscriptions/:id/cancel", async (req, res) => {
  const result = await cancelSubscription({ subscriptionId: req.params.id });
  return res.status(result.status === "cancelled" ? 200 : 202).json(result);
});

app.post("/subscriptions/:id/view", (req, res) => res.json(recordView({ subscriptionId: req.params.id })));

app.get("/customers/:id/invoices", async (req, res) => {
  try {
    return res.json(await listInvoices({ customerId: req.params.id }));
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post("/signups", async (req, res) => {
  try {
    const subscription = await createSignup({ customerId: String(req.body.customerId || ""), planId: String(req.body.planId || "") });
    return res.status(201).json(subscription);
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post("/subscriptions/:id/receipt", async (req, res) => {
  const message = await sendReceipt({ subscriptionId: req.params.id, email: String(req.body.email || "") });
  if (!message) return res.status(404).json({ error: `no subscription ${req.params.id}` });
  return res.status(202).json(message);
});

// The five routes below each show one pattern failwalk's static checks find. See the controller for each.

app.post("/signups/retrying", async (req, res) => {
  try {
    const subscription = await createSignupRetryingWithoutKey({ customerId: String(req.body.customerId || ""), planId: String(req.body.planId || "") });
    return res.status(201).json(subscription);
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post("/welcome", async (req, res) => {
  try {
    return res.status(202).json(await sendWelcomeWithoutTimeout({ email: String(req.body.email || "") }));
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.delete("/subscriptions/:id", async (req, res) => res.json(await archiveSubscriptionSwallowingErrors({ subscriptionId: req.params.id })));

app.get("/subscriptions/:id/status", async (req, res) => {
  try {
    const status = await readStatusRetryingWithoutBackoff({ subscriptionId: req.params.id });
    if (!status) return res.status(404).json({ error: `no subscription ${req.params.id}` });
    return res.json(status);
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post("/subscriptions/:id/login", (req, res) => res.json(recordLoginWithoutAwait({ subscriptionId: req.params.id })));

module.exports = { app };
