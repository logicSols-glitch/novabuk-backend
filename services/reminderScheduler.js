/**
 * services/reminderScheduler.js
 * ────────────────────────────────
 * The piece that actually makes Feature 2 fire on its own. Runs on a
 * timer (every 15 minutes by default) and:
 *   1. Finds appointments due in ~24h or ~2h that haven't been
 *      reminded yet, sends a push (falling back to Termii SMS/WhatsApp
 *      if the patient's been inactive 48h+).
 *   2. Finds medication reminders due "now" for today's dose schedule,
 *      same fallback logic.
 *
 * REQUIRED PACKAGE: npm install node-cron
 *
 * TO START IT: in server.js, right after your DB connection succeeds:
 *   const { startReminderScheduler } = require("./services/reminderScheduler");
 *   startReminderScheduler();
 *
 * ── DESIGN ASSUMPTION WORTH KNOWING ABOUT ──
 * The spec gives frequencyPerDay + durationDays for medications, but
 * not specific times of day. This scheduler evenly spaces each day's
 * doses across an assumed "waking hours" window (8am–10pm). E.g.
 * frequencyPerDay=2 fires at ~8am and ~3pm; frequencyPerDay=3 fires at
 * ~8am, ~1pm, ~6pm. Adjust WAKING_HOUR_START/END below if you want a
 * different window — this was a judgment call, not something in the spec.
 */

const cron = require("node-cron");
const Appointment = require("../models/Appointment");
const MedicationReminder = require("../models/MedicationReminder");
const User = require("../models/User");
const {
  sendPushNotification,
  sendSmsReminder,
  sendWhatsappReminder,
} = require("./reminderService");

const RUN_INTERVAL_MINUTES = 15;
const INACTIVITY_FALLBACK_HOURS = 48; // per spec: only SMS/WhatsApp if inactive this long
const WAKING_HOUR_START = 8; // 8am
const WAKING_HOUR_END = 22; // 10pm

// ── SHARED: decide push vs SMS/WhatsApp fallback, and send ────
async function notifyPatient(user, title, body, dataForPush = {}) {
  const inactiveMs = user.lastActiveAt ? Date.now() - new Date(user.lastActiveAt).getTime() : Infinity;
  const inactiveHours = inactiveMs / (1000 * 60 * 60);

  if (inactiveHours < INACTIVITY_FALLBACK_HOURS) {
    // Patient's been active recently — push is enough.
    const result = await sendPushNotification({
      userId: user._id,
      fcmToken: user.fcmToken,
      title,
      body,
      data: dataForPush,
    });
    // If the token's actually dead, clear it so we stop retrying it forever.
    if (result.invalidToken) {
      await User.findByIdAndUpdate(user._id, { fcmToken: null });
    }
    return result;
  }

  // Inactive 48h+ — fall back to Termii. Try WhatsApp first, then SMS.
  if (!user.phone) {
    console.warn(`[reminderScheduler] User ${user._id} inactive ${Math.round(inactiveHours)}h but has no phone number on file — cannot fall back.`);
    return { success: false, reason: "No phone number for fallback" };
  }

  const waResult = await sendWhatsappReminder({ userId: user._id, whatsappNumber: user.phone, message: body });
  if (waResult.success) return waResult;

  return sendSmsReminder({ userId: user._id, phone: user.phone, message: body });
}

// ── APPOINTMENT REMINDERS (24h and 2h before) ─────────────────
async function checkAppointmentReminders() {
  const now = new Date();
  const windowMs = RUN_INTERVAL_MINUTES * 60 * 1000;

  // 24h-before window: appointments scheduled between (now+24h) and
  // (now+24h+interval) — a sliding window that catches each
  // appointment exactly once as its 24h mark passes through this run.
  const in24hStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in24hEnd = new Date(in24hStart.getTime() + windowMs);

  const due24h = await Appointment.find({
    status: "scheduled",
    scheduledAt: { $gte: in24hStart, $lt: in24hEnd },
    "remindersSent.push24h": false,
  }).populate("patient", "fullName fcmToken lastActiveAt phone");

  for (const appt of due24h) {
    if (!appt.patient) continue;
    await notifyPatient(
      appt.patient,
      "Appointment Tomorrow",
      `Reminder: you have an appointment tomorrow at ${new Date(appt.scheduledAt).toLocaleString()}.`,
      { appointmentId: appt._id.toString(), type: "appointment_24h" }
    );
    appt.remindersSent.push24h = true;
    await appt.save();
  }

  // 2h-before window, same pattern
  const in2hStart = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const in2hEnd = new Date(in2hStart.getTime() + windowMs);

  const due2h = await Appointment.find({
    status: "scheduled",
    scheduledAt: { $gte: in2hStart, $lt: in2hEnd },
    "remindersSent.push2h": false,
  }).populate("patient", "fullName fcmToken lastActiveAt phone");

  for (const appt of due2h) {
    if (!appt.patient) continue;
    await notifyPatient(
      appt.patient,
      "Appointment Soon",
      `Reminder: your appointment is in about 2 hours, at ${new Date(appt.scheduledAt).toLocaleString()}.`,
      { appointmentId: appt._id.toString(), type: "appointment_2h" }
    );
    appt.remindersSent.push2h = true;
    await appt.save();
  }

  if (due24h.length || due2h.length) {
    console.log(`[reminderScheduler] Sent ${due24h.length} 24h-reminders, ${due2h.length} 2h-reminders.`);
  }
}

// ── MEDICATION REMINDERS ──────────────────────────────────────
// See the "DESIGN ASSUMPTION" note at the top of this file re: how
// times of day are derived from frequencyPerDay.
function computeTodaysDoseTimes(frequencyPerDay) {
  const windowHours = WAKING_HOUR_END - WAKING_HOUR_START;
  const interval = windowHours / frequencyPerDay;
  const times = [];
  for (let i = 0; i < frequencyPerDay; i++) {
    const hour = WAKING_HOUR_START + i * interval;
    const d = new Date();
    d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
    times.push(d);
  }
  return times;
}

async function checkMedicationReminders() {
  const now = new Date();

  const activeReminders = await MedicationReminder.find({
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).populate("patient", "fullName fcmToken lastActiveAt phone");

  let sentCount = 0;

  for (const med of activeReminders) {
    if (!med.patient) continue;

    const doseTimes = computeTodaysDoseTimes(med.frequencyPerDay);

    for (const doseTime of doseTimes) {
      // Only consider doses whose time has already passed today, and
      // haven't already been sent (checked via remindersSentLog,
      // matched within a 30-minute tolerance of the run interval).
      if (now < doseTime) continue;

      const alreadySent = med.remindersSentLog.some((log) => {
        const diff = Math.abs(new Date(log.firedAt).getTime() - doseTime.getTime());
        return diff < 30 * 60 * 1000; // within 30 minutes counts as "this dose already handled"
      });
      if (alreadySent) continue;

      await notifyPatient(
        med.patient,
        "Medication Reminder",
        `Time to take your ${med.drugName} (${med.dosage}).`,
        { medicationReminderId: med._id.toString(), type: "medication" }
      );

      med.remindersSentLog.push({ firedAt: doseTime });
      sentCount++;
    }

    if (med.isModified()) await med.save();
  }

  if (sentCount) {
    console.log(`[reminderScheduler] Sent ${sentCount} medication reminders.`);
  }
}

// ── MAIN JOB ───────────────────────────────────────────────────
async function runReminderCheck() {
  try {
    await checkAppointmentReminders();
    await checkMedicationReminders();
  } catch (err) {
    console.error("[reminderScheduler] Job failed:", err.message);
  }
}

function startReminderScheduler() {
  // Runs every 15 minutes. Cron syntax: minute step of 15.
  cron.schedule(`*/${RUN_INTERVAL_MINUTES} * * * *`, runReminderCheck);
  console.log(`[reminderScheduler] Started — checking every ${RUN_INTERVAL_MINUTES} minutes.`);
}

module.exports = { startReminderScheduler, runReminderCheck };