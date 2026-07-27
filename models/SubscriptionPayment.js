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
 * This is intentionally NOT a live payment gateway integration — it's
 * the "customProvider" referenced in services/paymentProviders/, kept
 * separate from that folder's pluggable interface so a real gateway
 * (Paystack, Flutterwave) can be added later as a sibling provider
 * without touching this manual-review flow at all.
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
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    // NVB-SUB-[YEAR][MONTH]-[SEQUENCE] — generated server-side (see
    // getNextSubscriptionReference in routes/clinics.js), same atomic
    // Counter pattern billingService.js already uses for receipts.
    // The clinic includes this in their bank transfer narration so an
    // admin can match it against the bank statement.
    reference: {
      type: String,
      required: true,
      unique: true,
    },
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

    reviewedById: { type: mongoose.Schema.Types.ObjectId, default: null },
    reviewedByName: { type: String, default: "" }, // snapshot, same pattern as PatientBill's editHistory
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: "" }, // required when rejecting — the reason shown back to the clinic
  },
  { timestamps: true }
);

module.exports = mongoose.model("SubscriptionPayment", subscriptionPaymentSchema);