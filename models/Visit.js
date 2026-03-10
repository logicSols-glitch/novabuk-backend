const mongoose = require("mongoose");

const visitSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
    },
    // Symptom log that triggered this visit (optional)
    symptomLog: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Symptom",
      default: null,
    },
    // Visit status lifecycle
    status: {
      type: String,
      enum: ["Pending", "Confirmed", "Completed", "Cancelled"],
      default: "Pending",
    },
    // Preferred date/time from patient
    preferredDate: {
      type: Date,
      default: null,
    },
    // Notes from patient at time of request
    notes: {
      type: String,
      default: "",
    },
    // Notes added by clinic after visit
    clinicNotes: {
      type: String,
      default: "",
    },
    // Snapshot of health profile sent to clinic at time of request
    // (so clinic has context even if user updates profile later)
    healthProfileSnapshot: {
      ageRange: String,
      gender: String,
      existingConditions: [String],
      allergies: [String],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Visit", visitSchema);
