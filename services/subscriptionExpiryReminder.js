/**
 * services/subscriptionExpiryReminder.js
 * ──────────────────────────────────────────
 * Daily job: emails any clinic whose paid subscription expires within
 * the next 7 days, so they can renew before losing Pro/Growth features
 * (see routes/clinic-lab.js, clinic-pharmacy.js, and
 * middleware/enforceFreeTierLimit.js — all of which drop a lapsed
 * clinic straight to FREE_TIER the moment subscriptionExpiry passes).
 *
 * This is the one place in the subscription system where a cron is
 * actually the right tool: unlike enforcement (getEffectiveStatus in
 * services/subscriptionService.js, computed fresh on every request —
 * see that file's comment for why access control never depends on a
 * cron having run recently), a MISSED reminder email is just a missed
 * reminder, not a security gap. A day's delay here costs nothing but
 * doesn't grant anyone access they shouldn't have.
 *
 * Threshold is "<= 7 days left", not "exactly 7 days left" — so a
 * skipped run (deploy downtime, etc.) still catches the clinic on day
 * 6, 5, etc. rather than missing the window entirely. Clinic.
 * expiryReminderSentFor stops it from re-sending for the SAME expiry
 * date every day until it renews or lapses — see the field's comment
 * on models/Clinic.js for why comparing against the current
 * subscriptionExpiry (rather than a plain boolean) also means a
 * renewal automatically makes the clinic eligible for a fresh
 * reminder next cycle, with no manual reset needed.
 *
 * REQUIRED PACKAGE: node-cron (already a dependency — see
 * services/reminderScheduler.js, which uses the same package for
 * appointment/medication reminders).
 *
 * TO START IT: in server.js, alongside startReminderScheduler():
 *   const { startSubscriptionExpiryReminder } = require("./services/subscriptionExpiryReminder");
 *   startSubscriptionExpiryReminder();
 */

const cron = require("node-cron");
const Clinic = require("../models/Clinic");
const SubscriptionPayment = require("../models/SubscriptionPayment");
const { sendSubscriptionExpiringEmail } = require("./emailService");

const REMINDER_WINDOW_DAYS = 7;

async function resolveNotifyEmail(clinic) {
  if (clinic.contactEmail) return clinic.contactEmail;

  // Fallback — no contactEmail on file, so use whoever most recently
  // paid for this clinic's subscription (same submittedByEmail
  // snapshot the payment-confirmation emails use).
  const lastPayment = await SubscriptionPayment.findOne({
    clinic: clinic._id,
    status: "VERIFIED",
  }).sort({ reviewedAt: -1 });

  return lastPayment?.submittedByEmail || null;
}

async function checkExpiringSubscriptions() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await Clinic.find({
    subscriptionStatus: "Active",
    subscriptionExpiry: { $gte: now, $lte: windowEnd },
  });

  let sentCount = 0;

  for (const clinic of candidates) {
    // Already reminded for THIS exact expiry date — skip. A renewal
    // changes subscriptionExpiry to a new date, which naturally makes
    // this comparison false again next cycle.
    if (
      clinic.expiryReminderSentFor &&
      clinic.expiryReminderSentFor.getTime() === clinic.subscriptionExpiry.getTime()
    ) {
      continue;
    }

    const notifyEmail = await resolveNotifyEmail(clinic);
    if (!notifyEmail) {
      console.warn(`[subscriptionExpiryReminder] Clinic ${clinic._id} has no email on file to remind — skipping.`);
      continue;
    }

    const daysLeft = Math.max(0, Math.ceil((clinic.subscriptionExpiry - now) / (24 * 60 * 60 * 1000)));

    try {
      await sendSubscriptionExpiringEmail({
        to: notifyEmail,
        clinicName: clinic.name,
        plan: clinic.subscriptionPlan,
        expiryDate: clinic.subscriptionExpiry,
        daysLeft,
      });

      clinic.expiryReminderSentFor = clinic.subscriptionExpiry;
      await clinic.save();
      sentCount += 1;
    } catch (err) {
      // Don't mark expiryReminderSentFor on failure — leaves it
      // eligible to retry on tomorrow's run instead of silently
      // never reminding this clinic for this expiry cycle.
      console.error(`[subscriptionExpiryReminder] Failed to email clinic ${clinic._id}:`, err.message);
    }
  }

  if (sentCount) {
    console.log(`[subscriptionExpiryReminder] Sent ${sentCount} expiry reminder(s).`);
  }
}

function startSubscriptionExpiryReminder() {
  // Once daily at 8am — matches no particular urgency requirement,
  // just needs to run reliably once a day; a specific hour keeps
  // clinic admins from getting emails at random times.
  cron.schedule("0 8 * * *", checkExpiringSubscriptions);
  console.log("[subscriptionExpiryReminder] Started — checking daily at 08:00.");
}

module.exports = { startSubscriptionExpiryReminder, checkExpiringSubscriptions };