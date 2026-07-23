const mongoose = require("mongoose");

/**
 * ClinicFeeSchedule — each clinic sets its own consultation fees per
 * visit type. No hardcoded pricing anywhere in the system — every
 * clinic configures this themselves (Settings → Billing).
 */
const clinicFeeScheduleSchema = new mongoose.Schema(
  {
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    visitType: {
      type: String,
      enum: ["General", "Specialist", "Follow-up", "Emergency"],
      required: true,
    },
    feeAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// One fee entry per visit type per clinic — setting a new fee for the
// same type updates the existing entry rather than creating a duplicate.
clinicFeeScheduleSchema.index({ clinic: 1, visitType: 1 }, { unique: true });

module.exports = mongoose.model("ClinicFeeSchedule", clinicFeeScheduleSchema);