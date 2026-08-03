const mongoose = require("mongoose");

/**
 * ClinicUsage — Feature 3 (Free Degraded Tier). Tracks how many of the
 * FREE_TIER-limited actions a clinic has used this calendar month.
 *
 * One row per clinic per month (billingMonth: "YYYY-MM"), not a single
 * row reset in place — this means there's no reset cron needed at
 * all. A clinic entering a new month simply doesn't have a row yet;
 * the first limited action of the month creates one starting at 0.
 * Old rows are never deleted, so this doubles as a free usage-history
 * log (useful later for "which clinics are close to upgrading"
 * reporting) without any extra bookkeeping.
 *
 * Only used for clinics whose EFFECTIVE status is FREE_TIER — see
 * services/subscriptionService.js's getEffectiveStatus(). TRIAL and
 * any actively-paid clinic never touch this collection at all.
 */
const clinicUsageSchema = new mongoose.Schema(
  {
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    billingMonth: {
      type: String, // "YYYY-MM", e.g. "2026-08"
      required: true,
    },
    patientHistorySearches: { type: Number, default: 0 },
    newWalkinPatients: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One row per clinic per month — also what the upsert-then-increment
// pattern in middleware/enforceFreeTierLimit.js relies on to stay
// correct under concurrent requests (see that file for the atomic
// $inc-if-under-limit pattern, same idea as models/Counter.js).
clinicUsageSchema.index({ clinic: 1, billingMonth: 1 }, { unique: true });

module.exports = mongoose.model("ClinicUsage", clinicUsageSchema);