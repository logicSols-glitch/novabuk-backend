const mongoose = require("mongoose");

/**
 * PrivateNote — a doctor's own note about a patient, separate from the
 * shared clinical fields on Visit (diagnosis/prescription/advice/etc.,
 * which every doctor AND nurse in the clinic already sees).
 *
 * Defaults to PRIVATE — visible only to the doctor who wrote it.
 * The author can mark it "shared", making it visible to OTHER DOCTORS
 * in the same clinic too (for record-keeping / handoff / second
 * opinions) — but NEVER to nurse/receptionist/pharmacist/lab_tech,
 * regardless of sharing status. This is strictly doctor-to-doctor.
 *
 * NOT tied to a single visit necessarily — a doctor may want an
 * ongoing note about a patient across their whole relationship, not
 * just one encounter. `visit` is optional for that reason.
 */
const privateNoteSchema = new mongoose.Schema(
  {
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    visit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Visit",
      default: null, // optional — a note can stand alone, not tied to one encounter
    },

    // Same owner-vs-ClinicStaff pattern as Appointment.js — a "doctor"
    // here can be either the clinic owner (User) or an added
    // ClinicStaff doctor.
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    authorType: {
      type: String,
      enum: ["User", "ClinicStaff"],
      required: true,
    },
    authorName: {
      type: String,
      required: true, // snapshot at write-time, so the name displays even if the author account is later removed
    },

    content: {
      type: String,
      required: [true, "Note content is required"],
      trim: true,
    },

    visibility: {
      type: String,
      enum: ["private", "shared"],
      default: "private",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PrivateNote", privateNoteSchema);