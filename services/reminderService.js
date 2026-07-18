/**
 * services/reminderService.js
 * ──────────────────────────────
 * Handles the three notification channels from Feature 2 (Appointment &
 * Medication Reminders): FCM push, Google Calendar invites, Termii
 * SMS/WhatsApp fallback.
 *
 * STATUS: structure complete, safe to call from clinic-visits.js right
 * now — every function below degrades to a console.log + no-op until
 * its real credentials are wired in. Nothing will crash; reminders
 * just won't actually send anywhere yet.
 *
 * TO ACTIVATE EACH CHANNEL:
 *   1. FCM: create a Firebase project → Project Settings → Service
 *      Accounts → Generate new private key → save as a JSON file →
 *      set FCM_SERVICE_ACCOUNT_JSON (the file contents, or a path) in
 *      your env vars → `npm install firebase-admin` → fill in
 *      sendPushNotification() below.
 *   2. Google Calendar: Google Cloud Console → create OAuth 2.0 Client
 *      ID (type: Web application) → enable Calendar API → set
 *      GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET →
 *      build the one-time patient consent flow (a new frontend page,
 *      not built yet) → fill in createCalendarEvent() below.
 *   3. Termii: sign up at termii.com → get API key → set
 *      TERMII_API_KEY → fill in sendSmsReminder()/sendWhatsappReminder().
 */

// ── FCM PUSH NOTIFICATION ─────────────────────────────────────
// Fires for: appointment reminders (24h/2h before), medication
// reminders, lab-results-ready (future), general in-app alerts.
async function sendPushNotification({ userId, fcmToken, title, body, data = {} }) {
  if (!process.env.FCM_SERVICE_ACCOUNT_JSON) {
    console.log(`[reminderService] FCM not configured yet. Would have sent to user ${userId}: "${title}" — "${body}"`);
    return { success: false, skipped: true, reason: "FCM not configured" };
  }

  if (!fcmToken) {
    console.log(`[reminderService] User ${userId} has no FCM token registered — skipping push.`);
    return { success: false, skipped: true, reason: "No FCM token for this user" };
  }

  // TODO once Firebase project exists:
  // const admin = require("firebase-admin");
  // if (!admin.apps.length) {
  //   admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON)) });
  // }
  // try {
  //   await admin.messaging().send({ token: fcmToken, notification: { title, body }, data });
  //   return { success: true };
  // } catch (err) {
  //   console.error("[reminderService] FCM send failed:", err.message);
  //   return { success: false, error: err.message };
  // }

  return { success: false, skipped: true, reason: "FCM integration not yet implemented" };
}

// ── GOOGLE CALENDAR EVENT ─────────────────────────────────────
// Only fires if the patient has granted calendar permission (OAuth
// consent flow — not built yet, needs a new onboarding step in the
// patient app where they connect their Google account once).
async function createCalendarEvent({ userId, googleAccessToken, title, description, startTime, endTime }) {
  if (!process.env.GOOGLE_CALENDAR_CLIENT_ID) {
    console.log(`[reminderService] Google Calendar not configured yet. Would have created event for user ${userId}: "${title}" at ${startTime}`);
    return { success: false, skipped: true, reason: "Google Calendar not configured" };
  }

  if (!googleAccessToken) {
    console.log(`[reminderService] User ${userId} hasn't granted calendar permission — skipping.`);
    return { success: false, skipped: true, reason: "No calendar permission granted" };
  }

  // TODO once OAuth client + consent flow exist:
  // const { google } = require("googleapis");
  // const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CALENDAR_CLIENT_ID, process.env.GOOGLE_CALENDAR_CLIENT_SECRET);
  // oauth2Client.setCredentials({ access_token: googleAccessToken });
  // const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  // try {
  //   const event = await calendar.events.insert({
  //     calendarId: "primary",
  //     requestBody: {
  //       summary: title,
  //       description,
  //       start: { dateTime: startTime },
  //       end: { dateTime: endTime },
  //       reminders: { useDefault: true }, // Google's own 15min/1hr defaults — free
  //     },
  //   });
  //   return { success: true, eventId: event.data.id };
  // } catch (err) {
  //   console.error("[reminderService] Calendar event creation failed:", err.message);
  //   return { success: false, error: err.message };
  // }

  return { success: false, skipped: true, reason: "Google Calendar integration not yet implemented" };
}

// ── TERMII SMS/WHATSAPP FALLBACK ──────────────────────────────
// Only fires if the patient hasn't opened the app in the last 48
// hours — check User.lastActiveAt (needs adding to the User model —
// see note in clinic-visits.js integration).
async function sendSmsReminder({ userId, phone, message }) {
  if (!process.env.TERMII_API_KEY) {
    console.log(`[reminderService] Termii not configured yet. Would have SMS'd ${phone}: "${message}"`);
    return { success: false, skipped: true, reason: "Termii not configured" };
  }

  // TODO once Termii account exists:
  // const res = await fetch("https://api.ng.termii.com/api/sms/send", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     api_key: process.env.TERMII_API_KEY,
  //     to: phone,
  //     from: "NovaBuk",
  //     sms: message,
  //     type: "plain",
  //     channel: "generic",
  //   }),
  // });
  // const data = await res.json();
  // return { success: data.code === "ok", raw: data };

  return { success: false, skipped: true, reason: "Termii SMS integration not yet implemented" };
}

async function sendWhatsappReminder({ userId, whatsappNumber, message }) {
  if (!process.env.TERMII_API_KEY) {
    console.log(`[reminderService] Termii not configured yet. Would have WhatsApp'd ${whatsappNumber}: "${message}"`);
    return { success: false, skipped: true, reason: "Termii not configured" };
  }

  // TODO once Termii account exists — same endpoint, channel: "whatsapp"
  return { success: false, skipped: true, reason: "Termii WhatsApp integration not yet implemented" };
}

module.exports = {
  sendPushNotification,
  createCalendarEvent,
  sendSmsReminder,
  sendWhatsappReminder,
};