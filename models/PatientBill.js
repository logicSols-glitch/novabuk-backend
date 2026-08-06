const mongoose = require("mongoose");

/**
 * PatientBill — auto-generated when a doctor completes a consultation
 * (see clinic-visits.js /visits/:id/complete).
 *
 * NOTE ON LINE ITEMS: the source spec describes bill_line_items as a
 * separate table with a bill_id foreign key. In MongoDB, line items
 * that always belong to exactly one bill and are always read/written
 * together with it are a textbook case for EMBEDDING rather than a
 * separate collection — so they're an array subdocument here instead.
 * Functionally equivalent, just idiomatic for this database.
 */
const billLineItemSchema = new mongoose.Schema(
  {
    itemType: {
      type: String,
      enum: ["CONSULTATION", "LAB", "PHARMACY", "OTHER"],
      required: true,
    },
    description: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const patientBillSchema = new mongoose.Schema(
  {
    visit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Visit",
      required: true,
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    lineItems: [billLineItemSchema],

    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 }, // subtotal - discount
    amountPaid: { type: Number, default: 0, min: 0 },
    // Tracks payment collected specifically through the pharmacist's own
    // checkout (PATCH /bills/:id/pay-pharmacy), scoped to PHARMACY line
    // items only. Always <= the sum of this bill's PHARMACY line items.
    // amountPaid (above) is the running total across BOTH this and the
    // general front-desk payment route — this field exists so we can
    // work out how much of the pharmacy portion specifically is still
    // outstanding, without a pharmacist's payment ever being able to
    // count toward consultation/lab charges.
    amountPaidPharmacy: { type: Number, default: 0, min: 0 },
    // Same idea as amountPaidPharmacy, but for LAB line items and the
    // lab tech's own checkout (PATCH /bills/:id/pay-lab). Lab charges
    // land on the bill at ORDER time (not result time, unlike
    // pharmacy — see LabRequest.js), so this can be collectible
    // before a single result has even been entered.
    amountPaidLab: { type: Number, default: 0, min: 0 },

    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PART_PAID", "PAID", "WAIVED"],
      default: "UNPAID",
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ["CASH", "TRANSFER", "POS", "WAIVED", null],
      default: null,
    },
    waivedReason: { type: String, default: "" }, // required when paymentStatus === WAIVED

    receiptNumber: {
      type: String,
      unique: true,
      sparse: true, // only assigned once actually paid/waived, not at bill creation
    },
    paidAt: { type: Date, default: null },

    // Who marked it paid — same owner-vs-ClinicStaff pattern used
    // throughout (Appointment.js, PrivateNote.js)
    handledById: { type: mongoose.Schema.Types.ObjectId, default: null },
    handledByType: { type: String, enum: ["User", "ClinicStaff", null], default: null },

    // Audit trail for the bill-correction workflow (owner/admin only,
    // before payment settles). Every correction is logged rather than
    // silently overwriting — a bill is a financial record, corrections
    // should be traceable, not invisible.
    editHistory: [
      {
        editedById: { type: mongoose.Schema.Types.ObjectId },
        editedByType: { type: String, enum: ["User", "ClinicStaff"] },
        editedByName: { type: String },
        previousTotal: { type: Number },
        newTotal: { type: Number },
        reason: { type: String },
        editedAt: { type: Date, default: Date.now },
      },
    ],

    // Itemized payment ledger — every individual payment event, not
    // just the running totals above. paymentMethod/amountPaid/
    // handledById/handledByType (above) still reflect the MOST RECENT
    // payment for quick display (receipts, bill lists), but this array
    // is the source of truth for "how did this bill actually get
    // paid" — e.g. cash collected by the pharmacist for drugs, a
    // separate transfer collected by the lab tech, and a third
    // payment collected by reception for the consultation. /bills/:id/pay,
    // /bills/:id/pay-pharmacy, and /bills/:id/pay-lab all append here.
    payments: [
      {
        amount: { type: Number, required: true },
        method: { type: String, enum: ["CASH", "TRANSFER", "POS", "WAIVED"], required: true },
        // Which part of the bill this payment counted against —
        // PHARMACY payments only ever come from /pay-pharmacy (capped
        // to PHARMACY line items), LAB only from /pay-lab (capped to
        // LAB line items); GENERAL covers everything else
        // (consultation, or the whole bill at once via the front-desk
        // route).
        scope: { type: String, enum: ["GENERAL", "PHARMACY", "LAB"], required: true },
        recordedById: { type: mongoose.Schema.Types.ObjectId, required: true },
        recordedByType: { type: String, enum: ["User", "ClinicStaff"], required: true },
        recordedByName: { type: String, required: true }, // snapshot, same reasoning as editedByName above
        recordedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("PatientBill", patientBillSchema);