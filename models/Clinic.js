const mongoose = require("mongoose");

const clinicSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Clinic name is required"],
      trim: true,
    },
    location: {
      address: { type: String, required: true },
      city: { type: String, required: true, index: true },
      state: { type: String, default: "" },
      coordinates: {
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
      },
    },
    contactPhone: { type: String, default: "" },
    contactEmail: { type: String, default: "" },
    // Operating hours
    openingHours: {
      monday:    { open: String, close: String },
      tuesday:   { open: String, close: String },
      wednesday: { open: String, close: String },
      thursday:  { open: String, close: String },
      friday:    { open: String, close: String },
      saturday:  { open: String, close: String },
      sunday:    { open: String, close: String },
    },
    // Dynamic open/closed status (can be toggled by admin)
    isOpen: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Services offered
    services: {
      type: [String],
      default: [],
    },
    image: {
      type: String,
      default: "",
    },
    // ── Subscription & Plans ─────────────────────────────
    // Matches config/plans.js — that file is the single source of truth
    // for pricing, seat limits, and allowed roles per plan. Add new plans
    // there, not here — this enum just needs to accept the same keys.
    subscriptionPlan: {
      type: String,
      enum: ["Growth", "Pro", "Enterprise"],
      default: "Growth",
    },
    subscriptionStatus: {
      type: String,
      enum: ["Active", "Expired", "Past Due"],
      default: "Active",
    },
    subscriptionExpiry: { type: Date, default: null },
    // 60-day free trial window from clinic creation, before any
    // plan/billing enforcement kicks in. Not enforced anywhere yet —
    // just tracked now so billing logic added later doesn't require
    // another schema migration.
    trialEndsAt: {
      type: Date,
      default: () => new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
    // Stores the exact subscriptionExpiry value a "your subscription
    // expires soon" email was already sent for (see
    // services/subscriptionExpiryReminder.js). Comparing against the
    // CURRENT subscriptionExpiry rather than just a boolean/date flag
    // means a renewal (which changes subscriptionExpiry to a new,
    // later date) naturally makes this stale and re-eligible for a
    // reminder next time — no manual reset needed anywhere.
    expiryReminderSentFor: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Clinic", clinicSchema);