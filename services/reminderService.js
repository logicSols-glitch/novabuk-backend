/**
 * services/reminderService.js
 * ──────────────────────────────
 * Handles the three notification channels from Feature 2 (Appointment &
 * Medication Reminders): FCM push, Google Calendar invites, Termii
 * SMS/WhatsApp fallback.
 *
 * REQUIRED ENV VARS (set these on Render, never commit them or paste
 * them in chat):
 *   FCM_SERVICE_ACCOUNT_JSON        — full contents of the Firebase
 *                                     service account JSON file, as a
 *                                     single-line string
 *   GOOGLE_CALENDAR_CLIENT_ID
 *   GOOGLE_CALENDAR_CLIENT_SECRET
 *   TERMII_API_KEY
 *   TERMII_SENDER_ID                — your approved Sender ID (e.g. "NovaBuk")
 *
 * REQUIRED PACKAGES:
 *   npm install firebase-admin googleapis
 *   (Termii uses plain fetch — no SDK needed)
 */

const admin = require("firebase-admin");
const { google } = require("googleapis");

// ── FIREBASE ADMIN INIT (once, lazily) ────────────────────────
let firebaseInitialized = false;
function ensureFirebaseInitialized() {
  if (firebaseInitialized) return true;
  if (!process.env.FCM_SERVICE_ACCOUNT_JSON) return false;

  try {
    const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseInitialized = true;
    return true;
  } catch (err) {
    console.error("[reminderService] Failed to initialize Firebase Admin:", err.message);
    return false;
  }
}

// ── FCM PUSH NOTIFICATION ─────────────────────────────────────
async function sendPushNotification({ userId, fcmToken, title, body, data = {} }) {
  if (!ensureFirebaseInitialized()) {
    console.log(`[reminderService] FCM not configured. Would have sent to user ${userId}: "${title}" — "${body}"`);
    return { success: false, skipped: true, reason: "FCM not configured" };
  }

  if (!fcmToken) {
    console.log(`[reminderService] User ${userId} has no FCM token registered — skipping push.`);
    return { success: false, skipped: true, reason: "No FCM token for this user" };
  }

  try {
    // data payload values must all be strings per FCM's requirements
    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    );

    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: stringData,
    });
    return { success: true };
  } catch (err) {
    console.error("[reminderService] FCM send failed:", err.message);

    // A token can go stale (app uninstalled, permissions revoked, etc.)
    // — the caller should clear User.fcmToken when they see this so we
    // stop retrying a dead token forever.
    const isInvalidToken =
      err.code === "messaging/invalid-registration-token" ||
      err.code === "messaging/registration-token-not-registered";

    return { success: false, error: err.message, invalidToken: isInvalidToken };
  }
}

// ── GOOGLE CALENDAR EVENT ─────────────────────────────────────
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  );
}

async function createCalendarEvent({ userId, googleAccessToken, googleRefreshToken, title, description, startTime, endTime }) {
  if (!process.env.GOOGLE_CALENDAR_CLIENT_ID) {
    console.log(`[reminderService] Google Calendar not configured. Would have created event for user ${userId}: "${title}" at ${startTime}`);
    return { success: false, skipped: true, reason: "Google Calendar not configured" };
  }

  if (!googleAccessToken) {
    console.log(`[reminderService] User ${userId} hasn't connected their Google Calendar — skipping.`);
    return { success: false, skipped: true, reason: "No calendar permission granted" };
  }

  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({
      access_token: googleAccessToken,
      refresh_token: googleRefreshToken, // lets the client auto-refresh an expired access token
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const event = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: title,
        description,
        start: { dateTime: startTime },
        end: { dateTime: endTime },
        reminders: { useDefault: true }, // Google's own 15min/1hr defaults — free, no extra work needed
      },
    });

    return { success: true, eventId: event.data.id };
  } catch (err) {
    console.error("[reminderService] Calendar event creation failed:", err.message);

    // A 401 here usually means the access token expired and the
    // refresh token itself was revoked — the caller should mark
    // User.googleCalendar.connected = false so the UI can prompt the
    // patient to reconnect, rather than silently failing forever.
    const needsReconnect = err.code === 401;
    return { success: false, error: err.message, needsReconnect };
  }
}

// Exchanges an OAuth authorization code (from the frontend consent
// flow — not built yet) for access + refresh tokens. Call this once,
// right after the patient completes Google's consent screen.
async function exchangeGoogleAuthCode(authCode) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(authCode);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  };
}

// ── TERMII SMS/WHATSAPP FALLBACK ──────────────────────────────
// Only call this if the patient hasn't opened the app in 48+ hours —
// check User.lastActiveAt before calling, not inside this function.
async function sendSmsReminder({ userId, phone, message }) {
  if (!process.env.TERMII_API_KEY) {
    console.log(`[reminderService] Termii not configured. Would have SMS'd ${phone}: "${message}"`);
    return { success: false, skipped: true, reason: "Termii not configured" };
  }

  try {
    const res = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TERMII_API_KEY,
        to: phone,
        from: process.env.TERMII_SENDER_ID || "NovaBuk",
        sms: message,
        type: "plain",
        channel: "generic",
      }),
    });
    const data = await res.json();
    return { success: data.code === "ok", raw: data };
  } catch (err) {
    console.error("[reminderService] Termii SMS send failed:", err.message);
    return { success: false, error: err.message };
  }
}

async function sendWhatsappReminder({ userId, whatsappNumber, message }) {
  if (!process.env.TERMII_API_KEY) {
    console.log(`[reminderService] Termii not configured. Would have WhatsApp'd ${whatsappNumber}: "${message}"`);
    return { success: false, skipped: true, reason: "Termii not configured" };
  }

  try {
    const res = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TERMII_API_KEY,
        to: whatsappNumber,
        from: process.env.TERMII_SENDER_ID || "NovaBuk",
        sms: message,
        type: "plain",
        channel: "whatsapp", // same endpoint, different channel — per Termii's docs
      }),
    });
    const data = await res.json();
    return { success: data.code === "ok", raw: data };
  } catch (err) {
    console.error("[reminderService] Termii WhatsApp send failed:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Sends an actual document (e.g. a PDF receipt) via WhatsApp, using
 * Termii's `media` parameter — verified against their real API docs
 * (developers.termii.com/messaging-api), which support a
 * `media: { url, caption }` object alongside channel: "whatsapp".
 * mediaUrl must be a publicly accessible URL (e.g. a Cloudinary link)
 * — Termii fetches the file from that URL, it isn't uploaded directly.
 */
async function sendWhatsAppDocument({ userId, whatsappNumber, caption, mediaUrl }) {
  if (!process.env.TERMII_API_KEY) {
    console.log(`[reminderService] Termii not configured. Would have sent document to ${whatsappNumber}: ${mediaUrl}`);
    return { success: false, skipped: true, reason: "Termii not configured" };
  }

  try {
    const res = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TERMII_API_KEY,
        to: whatsappNumber,
        from: process.env.TERMII_SENDER_ID || "NovaBuk",
        sms: caption, // required field even when sending media, per Termii's docs
        type: "plain",
        channel: "whatsapp",
        media: { url: mediaUrl, caption },
      }),
    });
    const data = await res.json();
    return { success: data.code === "ok", raw: data };
  } catch (err) {
    console.error("[reminderService] Termii WhatsApp document send failed:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendPushNotification,
  createCalendarEvent,
  exchangeGoogleAuthCode,
  sendSmsReminder,
  sendWhatsappReminder,
  sendWhatsAppDocument,
};