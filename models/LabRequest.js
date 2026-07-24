const mongoose = require("mongoose");

/**
 * LabRequest — ordered by a doctor closing a consultation.
 * Pro/Premium-tier only.
 *
 * UNLIKE Prescription, lab charges DO get billed at order time, not
 * result time — per the billing spec's own line ("Lab request charges
 * — if any tests were ordered"). This matches reality: running a
 * sample has a real cost the moment it's collected, regardless of
 * what the result turns out to be — unlike a prescribed drug, which
 * only costs something once actually dispensed.
 *
 * RESULT VISIBILITY: result_text/result_file_url must only ever be
 * visible to the doctor (and the clinic owner, who is a doctor by
 * construction) — never receptionist, never pharmacist. Enforced at
 * the response level in routes/clinic-lab.js, not just hidden in UI.
 */
const labRequestItemSchema = new mongoose.Schema(
  {
    testName: { type: String, required: true, trim: true },
    urgency: { type: String, enum: ["Routine", "Urgent"], default: "Routine" },
    sampleType: { type: String, enum: ["Blood", "Urine", "Stool", "Swab", "Other"], required: true },
    clinicalNotes: { type: String, default: "" },

    resultText: { type: String, default: "" },
    resultFileUrl: { type: String, default: null }, // Cloudinary URL, same pattern as routes/uploads.js
    resultEnteredAt: { type: Date, default: null },
    resultEnteredById: { type: mongoose.Schema.Types.ObjectId, default: null },
    resultEnteredByType: { type: String, enum: ["User", "ClinicStaff", null], default: null },

    // Price at order time — see ClinicLabPriceList. Snapshotted onto
    // the item so a later price-list change never retroactively
    // alters an already-billed request.
    priceCharged: { type: Number, default: null },
  },
  { _id: true }
);

const labRequestSchema = new mongoose.Schema(
  {
    visit: { type: mongoose.Schema.Types.ObjectId, ref: "Visit", required: true, index: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clinic: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    doctorType: { type: String, enum: ["User", "ClinicStaff"], required: true },

    items: [labRequestItemSchema],

    // Per the spec, status lives on the header, not per-item — even
    // though individual tests could technically finish at different
    // times. Matching the spec exactly rather than improving on it
    // unasked; flag to Faith if per-item status ever becomes needed.
    status: {
      type: String,
      enum: ["PENDING", "SAMPLE_COLLECTED", "RESULT_READY"],
      default: "PENDING",
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LabRequest", labRequestSchema);