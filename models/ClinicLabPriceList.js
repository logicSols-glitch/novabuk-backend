const mongoose = require("mongoose");

/**
 * ClinicLabPriceList — each clinic sets its own price per lab test
 * name. Looked up (case-insensitive, trimmed) when a doctor orders a
 * test, so the charge auto-appends to the visit's bill at order time.
 *
 * If a doctor types a test name with no matching price entry, the
 * request still gets created (never blocks clinical care over a
 * billing config gap) — it just doesn't add a line item, same
 * defensive pattern as generateBillForVisit() skipping consultation
 * billing when no fee is configured. The clinic can add the price
 * later and correct the bill via PATCH /bills/:id/correct.
 */
const clinicLabPriceListSchema = new mongoose.Schema(
  {
    clinic: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    testName: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

clinicLabPriceListSchema.index({ clinic: 1, testName: 1 }, { unique: true });

module.exports = mongoose.model("ClinicLabPriceList", clinicLabPriceListSchema);