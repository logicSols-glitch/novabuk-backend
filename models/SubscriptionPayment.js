const mongoose = require("mongoose");

/**
 * SubscriptionPayment — a clinic's claimed payment toward upgrading
 * (or renewing) their subscription plan.
 *
 * FLOW: clinic pays NovaBuk by bank transfer (outside the app — there's
 * no live card gateway wired up), then submits this record with the
 * reference their bank transfer used and the amount paid. A NovaBuk
 * admin reviews it against their bank statement and marks it VERIFIED
 * or REJECTED. Approval immediately activates the clinic's plan — see
 * routes/admin.js's /subscription-payments/:id/review route.
 *
 * This was originally the only ("MANUAL") flow — no live gateway.
 * NexaPay (services/paymentProviders/nexapay.js) is now wired in as
 * a sibling provider, same idea the original comment here predicted:
 * this record is provider-agnostic, `provider` below just tags which
 * one produced it. NEXAPAY rows are normally auto-verified by the
 * webhook (routes/webhooksNexapay.js) — reviewedById stays null and
 * verifiedVia explains how it happened. MANUAL rows keep working
 * exactly as before, admin review and all.
 */
const subscriptionPaymentSchema = new mongoose.Schema(
  {
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ["Growth", "Pro"],
      required: true,
    },
    // MONTHLY charges plan.priceMonthly; ANNUAL charges plan.priceAnnual * 12
    // upfront — see config/plans.js and services/subscriptionService.js.
    billingCycle: {
      type: String,
      enum: ["MONTHLY", "ANNUAL"],
      default: "MONTHLY",
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    // Which rail produced this row. MANUAL = old bank-transfer-and-
    // submit-a-reference flow. NEXAPAY = dedicated virtual account,
    // auto-verified by webhook — see services/paymentProviders/nexapay.js.
    provider: {
      type: String,
      enum: ["MANUAL", "NEXAPAY"],
      default: "MANUAL",
    },
    // NVB-SUB-[YEAR][MONTH]-[SEQUENCE] — generated server-side (see
    // getNextSubscriptionReference in services/subscriptionService.js),
    // same atomic Counter pattern billingService.js already uses for
    // receipts. For MANUAL payments, the clinic includes this in their
    // bank transfer narration so an admin can match it against the bank
    // statement. For NEXAPAY payments, this is passed as merchantReference
    // when creating the virtual account, and echoed back in the deposit
    // webhook so we can match the payment without any manual matching.
    reference: {
      type: String,
      required: true,
      unique: true,
    },
    // ── NEXAPAY-ONLY FIELDS (null/empty for MANUAL rows) ──────────
    // The dedicated account number shown to the clinic to transfer into.
    accountNumber: { type: String, default: "" },
    bankName: { type: String, default: "" },
    // NexaPay's own transactionId for the virtual-account creation call,
    // and separately for the deposit itself once the webhook lands —
    // kept as one field since we only need it for support/reconciliation,
    // not as a query key (reference already is).
    providerTransactionId: { type: String, default: "" },
    // eventId from the deposit.received webhook header — stored with a
    // sparse unique index so a redelivered/retried webhook is a safe
    // no-op instead of double-activating a plan or double-crediting.
    webhookEventId: { type: String },
    // Free-text the clinic provides — which bank, account name, date
    // sent, etc. — to help the admin locate the transfer. Not
    // verified by the system itself; it's context for a human reviewer.
    paymentNote: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "VERIFIED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    submittedById: { type: mongoose.Schema.Types.ObjectId, required: true },
    submittedByType: { type: String, enum: ["User", "ClinicStaff"], required: true },
    // Snapshot at submission time — same reasoning as recordedByName on
    // PatientBill: the payment-status emails (see services/emailService.js
    // and routes/webhooksNexapay.js) need somewhere to send to. Snapshotting
    // avoids a User/ClinicStaff lookup at send time and keeps working even
    // if that account is later deactivated or removed.
    submittedByEmail: { type: String, default: "" },
    submittedByName: { type: String, default: "" },

    // reviewedById stays null for webhook-verified NEXAPAY rows — there
    // was no human reviewer. reviewedByName is still set (e.g. "NexaPay
    // (auto)") so the billing history UI has something to display.
    reviewedById: { type: mongoose.Schema.Types.ObjectId, default: null },
    reviewedByName: { type: String, default: "" }, // snapshot, same pattern as PatientBill's editHistory
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: "" }, // required when rejecting — the reason shown back to the clinic
    verifiedVia: {
      type: String,
      enum: ["ADMIN_MANUAL", "WEBHOOK_AUTO", null],
      default: null,
    },
  },
  { timestamps: true }
);

// Sparse so MANUAL rows (which never have a webhookEventId) don't
// collide with each other on the unique constraint.
subscriptionPaymentSchema.index({ webhookEventId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("SubscriptionPayment", subscriptionPaymentSchema);