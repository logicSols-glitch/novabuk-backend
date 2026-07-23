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
  },
  { timestamps: true }
);

module.exports = mongoose.model("PatientBill", patientBillSchema);