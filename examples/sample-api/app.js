const express = require("express");
const { syncSubscription, cancelSubscription, recordView } = require("./controllers/subscriptions");
const { listInvoices } = require("./controllers/invoices");
const { sendReceipt } = require("./controllers/receipts");

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

app.post("/subscriptions/:id/receipt", async (req, res) => {
  const message = await sendReceipt({ subscriptionId: req.params.id, email: String(req.body.email || "") });
  if (!message) return res.status(404).json({ error: `no subscription ${req.params.id}` });
  return res.status(202).json(message);
});

module.exports = { app };
