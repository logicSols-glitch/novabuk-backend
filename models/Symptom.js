const mongoose = require("mongoose");

const symptomSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Quick-tag chips selected (Screen 6)
    tags: {
      type: [String],
      enum: ["Headache", "Fever", "Cough", "Body Pain", "Fatigue", "Other"],
      default: [],
    },
    // Free-text description
    description: {
      type: String,
      trim: true,
      default: "",
    },
    // Severity (optional, useful for clinic prep)
    severity: {
      type: String,
      enum: ["Mild", "Moderate", "Severe"],
      default: "Mild",
    },
    // Link to a visit if this log triggered one
    linkedVisit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Visit",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Symptom", symptomSchema);
