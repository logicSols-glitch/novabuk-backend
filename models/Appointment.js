const mongoose = require("mongoose");

/**
 * Appointment — created when a doctor sets a "next appointment" date
 * while closing a consultation (see clinic-visits.js /visits/:id/complete).
 *
 * NOTE ON doctor/doctorType: our system has TWO possible "doctor"
 * identities — the clinic OWNER (a User with role: "Doctors") or an
 * added ClinicStaff doctor. Rather than a fixed `ref`, doctorType tells
 * you which collection to populate from. Same pattern should be used
 * anywhere else in the codebase that needs to reference "whichever
 * doctor did this" (Visit.handledBy currently only refs "User" and
 * would silently fail to populate for a ClinicStaff doctor — a
 * pre-existing gap, separate from this feature, worth fixing later).
 */
const appointmentSchema = new mongoose.Schema(
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
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    doctorType: {
      type: String,
      enum: ["User", "ClinicStaff"], // which collection doctorId belongs to
      required: true,
    },
    visit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Visit",
      default: null, // the consultation this appointment was set from
    },
    scheduledAt: {
      type: Date,
      required: true,
      index: true, // the cron job (built once FCM is ready) will query on this
    },
    status: {
      type: String,
      enum: ["scheduled", "completed", "cancelled", "no_show"],
      default: "scheduled",
    },
    notes: { type: String, default: "" },

    // Tracks which reminder channels have already fired, so the future
    // cron job never double-sends. All false until the reminder
    // scheduler (built once FCM/Calendar/Termii are wired up) exists.
    remindersSent: {
      push24h: { type: Boolean, default: false },
      push2h: { type: Boolean, default: false },
      calendarEventCreated: { type: Boolean, default: false },
      calendarEventId: { type: String, default: null },
      smsSent: { type: Boolean, default: false },
      whatsappSent: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appointment", appointmentSchema);