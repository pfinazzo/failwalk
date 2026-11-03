import type { Seed, SeedName } from "../../src/proof/applySeed";

/**
 * The three bugs the proof plants, one per row. Each edits one clean file of the sample app and names the finding
 * failwalk must report. Every `after` keeps the wrapper call on its original line, so the site id does not move.
 */
export const SEEDS: Record<SeedName, Seed> = {
  "swallowed-catch": {
    name: "swallowed-catch",
    file: "controllers/subscriptions.js",
    before: [
      "  await database.update({",
      "    path: `subscriptions/${subscriptionId}`,",
      "    value: { status: subscription.status, plan: subscription.plan_id },",
      "  });",
    ].join("\n"),
    after: [
      "  try { await database.update({",
      "    path: `subscriptions/${subscriptionId}`,",
      "    value: { status: subscription.status, plan: subscription.plan_id },",
      "  }); } catch {}",
    ].join("\n"),
    site: "database.update@controllers/subscriptions.js:14",
    check: "swallowed-catch",
    harm: "The local copy of the subscription is never written, and the route still answers 200 with the vendor's record.",
  },
  "retry-without-idempotency-key": {
    name: "retry-without-idempotency-key",
    file: "controllers/subscriptions.js",
    before: "    await database.update({ path: `subscriptions/${subscriptionId}`, value: { status: cancelled.status } });",
    after:
      "    for (let attempt = 1; attempt <= 3; attempt += 1) { try { await database.update({ path: `subscriptions/${subscriptionId}`, value: { status: cancelled.status } }); break; } catch (error) { if (attempt === 3) throw error; await new Promise((resolve) => setTimeout(resolve, 10)); } }",
    site: "database.update@controllers/subscriptions.js:34",
    check: "retry-without-idempotency-key",
    harm: "A write whose answer was lost is sent again as a new write, so one cancellation can be recorded twice.",
  },
  "no-timeout": {
    name: "no-timeout",
    file: "config/database.js",
    before: [
      "module.exports = {",
      '  get: timed({ method: get, timeoutMs: DATABASE_TIMEOUT_MS, what: "database.get" }),',
      '  update: timed({ method: update, timeoutMs: DATABASE_TIMEOUT_MS, what: "database.update" }),',
      '  remove: timed({ method: remove, timeoutMs: DATABASE_TIMEOUT_MS, what: "database.remove" }),',
      "};",
    ].join("\n"),
    after: "module.exports = { get, update, remove };",
    site: "database.update@controllers/subscriptions.js:14",
    check: "no-timeout",
    harm: "A database that accepts the connection and never answers holds every request that writes a subscription open for ever.",
  },
};

/** The seed names in table order. */
export const SEED_NAMES: readonly SeedName[] = ["swallowed-catch", "retry-without-idempotency-key", "no-timeout"];
