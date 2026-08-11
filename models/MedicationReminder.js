const mongoose = require("mongoose");

/**
 * MedicationReminder — one per drug a doctor prescribes with a
 * reminder schedule, created alongside consultation close (see
 * clinic-visits.js /visits/:id/complete).
 *
 * endDate is computed server-side as startDate + durationDays, rather
 * than trusting a client-supplied end date, so the future reminder
 * scheduler has a reliable "stop firing after this date" boundary.
 */
const medicationReminderSchema = new mongoose.Schema(
  {
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },
    visit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Visit",
      default: null,
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
    drugName: { type: String, required: true, trim: true },
    dosage: { type: String, required: true, trim: true },
    frequencyPerDay: { type: Number, required: true, min: 1 },
    durationDays: { type: Number, required: true, min: 1 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true, index: true }, // startDate + durationDays, computed server-side

    // Log of which scheduled fire-times have already been sent — for
    // the future cron-based reminder scheduler, to avoid duplicate
    // pushes if the job runs more than once around a fire time.
    remindersSentLog: [{ firedAt: Date }],

    // Google Calendar recurring event IDs — one per dose-time-of-day,
    // not one per individual dose (see createMedicationCalendarEvents
    // in services/reminderService.js). frequencyPerDay=3 means up to
    // 3 IDs here, each a whole recurring series covering all
    // durationDays at once. Empty if the patient never connected
    // Google Calendar, or connected it after this reminder was created.
    calendarEventIds: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MedicationReminder", medicationReminderSchema);