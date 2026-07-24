const mongoose = require("mongoose");

/**
 * Prescription — issued by a doctor closing a consultation.
 * Pro/Premium-tier only (see Feature 1's plan gating).
 *
 * NOT billed at issue time — a prescribed drug isn't a real charge
 * until the pharmacist actually dispenses it (patient might not pick
 * it up, might already have it at home, pharmacy might substitute).
 * The bill line item gets appended at DISPENSE time — see the
 * dispense route in routes/clinic-pharmacy.js.
 */
const prescriptionItemSchema = new mongoose.Schema(
  {
    drugName: { type: String, required: true, trim: true },
    dosage: { type: String, required: true, trim: true },
    route: {
      type: String,
      enum: ["oral", "topical", "IV", "IM"],
      required: true,
    },
    frequency: { type: String, required: true, trim: true }, // e.g. "3 times daily" — dropdown + custom on the frontend
    durationDays: { type: Number, required: true, min: 1 },
    specialNotes: { type: String, default: "" },

    dispensed: { type: Boolean, default: false },
    dispensedAt: { type: Date, default: null },
    // Same owner-vs-ClinicStaff pattern used throughout
    dispensedById: { type: mongoose.Schema.Types.ObjectId, default: null },
    dispensedByType: { type: String, enum: ["User", "ClinicStaff", null], default: null },

    // Filled in by the pharmacist AT dispense time, not by the doctor
    // — real pharmacy prices fluctuate with stock/supplier cost, so a
    // fixed catalog price would be wrong more often than right.
    unitPrice: { type: Number, default: null },
    quantity: { type: Number, default: null },
  },
  { _id: true }
);

const prescriptionSchema = new mongoose.Schema(
  {
    visit: { type: mongoose.Schema.Types.ObjectId, ref: "Visit", required: true, index: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clinic: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    doctorType: { type: String, enum: ["User", "ClinicStaff"], required: true },

    items: [prescriptionItemSchema],

    status: {
      type: String,
      enum: ["ISSUED", "PARTIALLY_DISPENSED", "COMPLETED"],
      default: "ISSUED",
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Prescription", prescriptionSchema);