/**
 * services/paymentProviders/customProvider.js
 * ──────────────────────────────────────────────
 * The "custom" provider referenced by routes/clinics.js's /upgrade
 * route (it's the default when no `provider` is specified in the
 * request body). This is a manual, admin-reviewed verification path —
 * not a live gateway — backed by models/SubscriptionPayment.js.
 *
 * Every provider module in this folder must export verifyPayment(reference)
 * returning { success, amount, currency, raw } on success or
 * { success: false, error } on failure — see index.js for the shared
 * contract. This module fulfills that contract by looking up whether
 * an admin has already reviewed and approved the claimed payment.
 */

const SubscriptionPayment = require("../../models/SubscriptionPayment");

async function verifyPayment(reference) {
  const record = await SubscriptionPayment.findOne({ reference });

  if (!record) {
    return {
      success: false,
      error: "No payment submission found with this reference. Submit one via /clinics/subscription-payments first.",
    };
  }

  if (record.status === "REJECTED") {
    return {
      success: false,
      error: record.reviewNote || "This payment was reviewed and rejected. Contact NovaBuk support.",
    };
  }

  if (record.status === "PENDING") {
    return {
      success: false,
      error: "This payment is still awaiting review by NovaBuk. You'll be notified once it's verified.",
    };
  }

  // VERIFIED
  return {
    success: true,
    amount: record.amount,
    currency: "NGN",
    raw: record.toObject(),
  };
}

module.exports = { verifyPayment };