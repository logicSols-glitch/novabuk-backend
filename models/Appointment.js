const mongoose = require("mongoose");


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