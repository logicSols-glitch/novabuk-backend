const mongoose = require("mongoose");

const visitSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", required: true,
      index: true,
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic", required: true,
      index: true,
    },
    symptomLog: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Symptom", default: null,
    },
    // InProgress added for clinic consultation flow
    status: {
      type: String,
      enum: ["Pending", "Confirmed", "InProgress", "Completed", "Cancelled"],
      default: "Pending",
      index: true,
    },
    preferredDate:  { type: Date,   default: null },
    notes:          { type: String, default: "" },
    healthProfileSnapshot: {
      ageRange:           String,
      gender:             String,
      existingConditions: [String],
      allergies:          [String],
    },
    // Clinic consultation fields — filled by the doctor
    clinicNotes:  { type: String, default: "" },
    diagnosis:    { type: String, default: "" },
    prescription: { type: String, default: "" },
    testsOrdered: { type: String, default: "" },
    advice:       { type: String, default: "" },
    // handledBy → the User (Doctor) who ran the consultation
    handledBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    startedAt:    { type: Date, default: null },
    completedAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Visit", visitSchema);