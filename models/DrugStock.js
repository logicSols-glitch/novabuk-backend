const mongoose = require("mongoose");

/**
 * DrugStock — per-clinic pharmacy inventory. Opt-in, same philosophy
 * as ClinicLabPriceList: a clinic that never sets this up can still
 * dispense normally (nothing to check against), but once a drug HAS
 * a stock record, dispensing that drug is capped by what's actually
 * on hand — matched case-insensitively/trimmed against
 * Prescription.items.drugName, same pattern clinic-lab.js already
 * uses for test-price lookups.
 *
 * Deliberately NOT decremented by anything except an actual dispense
 * (routes/clinic-pharmacy.js) — a prescription being ISSUED doesn't
 * reserve stock, only DISPENSING actually consumes it, since a
 * doctor's prescription is not a guarantee the patient will pick it
 * up here rather than elsewhere (same reasoning PatientBill only
 * bills pharmacy charges at dispense time, not issue time).
 */
const drugStockSchema = new mongoose.Schema(
  {
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    drugName: { type: String, required: true, trim: true },
    quantityOnHand: { type: Number, required: true, default: 0, min: 0 },
    // Below this, the pharmacy dashboard flags it as low stock. Not
    // enforced against dispensing — you can still dispense down to 0,
    // this is purely a "reorder soon" signal, not a hard floor.
    reorderThreshold: { type: Number, default: 10, min: 0 },
    // Display only (e.g. "tablets", "bottles", "vials") — never used
    // in any calculation, just shown alongside the count so "40" reads
    // as "40 tablets" instead of an unlabeled number.
    unit: { type: String, default: "units", trim: true },
    lastRestockedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One stock record per drug name per clinic — the upsert pattern in
// routes/clinic-pharmacy.js's PUT /drug-stock relies on this exactly
// the way ClinicLabPriceList's unique index backs its own PUT route.
drugStockSchema.index({ clinic: 1, drugName: 1 }, { unique: true });

module.exports = mongoose.model("DrugStock", drugStockSchema);