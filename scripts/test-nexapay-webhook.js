/**
 * test-nexapay-webhook.js
 * ─────────────────────────
 * Sends a hand-crafted, correctly-signed `deposit.received` webhook
 * to your own /api/webhooks/nexapay endpoint — so you can confirm
 * whether your handler should be matching on `data.reference` or
 * `data.merchantReference`, without needing NexaPay's sandbox to
 * cooperate.
 *
 * HOW TO USE:
 *   1. npm install node-fetch   (if not already available — Node 18+
 *      has global fetch, so this may be unnecessary; see note below)
 *   2. Fill in the CONFIG section below.
 *   3. node test-nexapay-webhook.js
 *   4. Watch your Render logs (or local terminal) for the
 *      [webhooksNexapay] output and see which branch it hits.
 *
 * WHAT THIS PROVES:
 *   - If your handler logs "No matching PENDING payment" → the field
 *     it's matching on is wrong for this reference value.
 *   - If it logs "Activated ... for clinic ..." → the match worked.
 *   Run it twice: once with YOUR_REFERENCE placed in "reference",
 *   once with it placed in "merchantReference" (toggle FIELD_TO_TEST
 *   below), to see which one your handler actually needs.
 *
 * SAFETY: this hits YOUR endpoint only — it never touches NexaPay's
 * real servers, so it's safe to run against production as long as
 * you use a reference that matches a real PENDING row you don't mind
 * being auto-activated (or better: point WEBHOOK_URL at localhost /
 * a throwaway test payment first).
 */

const crypto = require("crypto");

// ── CONFIG — fill these in ──────────────────────────────────────
const WEBHOOK_URL = "https://novabuk-backend.onrender.com/api/webhooks/nexapay";
// ^ swap to "http://localhost:5000/api/webhooks/nexapay" to test locally instead

const WEBHOOK_SECRET = "874c5da0425355e9164e7cdd61fac24edc820b66a3e57fd9d83ea12e6cbecff7";
// ^ same value as NEXAPAY_WEBHOOK_SECRET in your Render env vars —
//   copy it from the NexaPay dashboard (Reveal/Copy button)

const YOUR_REFERENCE = "NVB-SUB-202608-00034";
// ^ paste in a REAL `reference` value from an existing PENDING
//   SubscriptionPayment row in your DB — this is what the webhook
//   needs to match against to actually find/activate that record

// Toggle this to test each theory:
//   "reference"        → puts YOUR_REFERENCE under data.reference
//   "merchantReference" → puts YOUR_REFERENCE under data.merchantReference
const FIELD_TO_TEST = "merchantReference";

const PAYMENT_AMOUNT = 60000;
// ^ must exactly match the `amount` stored on that SubscriptionPayment
//   row, since the handler rejects on amount mismatch too

// ── BUILD THE FAKE PAYLOAD ──────────────────────────────────────
const eventId = `evt_test_${Date.now()}`;

const data = {
  transactionId: `test_txn_${Date.now()}`,
  amount: PAYMENT_AMOUNT,
  senderName: "Test Sender",
  senderAccount: "0123456789",
  senderBank: "Test Bank",
  balanceAfter: PAYMENT_AMOUNT,
  status: "successful",
  metadata: { purpose: "wallet_topup", source: "test-script" },
};

// Puts YOUR_REFERENCE under whichever field you're testing, and a
// clearly-fake value under the other one, so a false match is
// impossible — if it matches, it matched on the field you intended.
data.reference = FIELD_TO_TEST === "reference" ? YOUR_REFERENCE : "nexapay-internal-ref-not-yours";
data.merchantReference = FIELD_TO_TEST === "merchantReference" ? YOUR_REFERENCE : "not-your-ref-either";

const payload = {
  event: "deposit.received",
  eventId,
  businessId: "test-business-id",
  businessName: "Test Business",
  environment: "test",
  occurredAt: new Date().toISOString(),
  data,
};

const rawBody = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000).toString();

// ── SIGN IT — same scheme as verifyWebhookSignature in nexapay.js ─
const signature = crypto
  .createHmac("sha256", WEBHOOK_SECRET)
  .update(`${timestamp}.${rawBody}`)
  .digest("hex");

// ── SEND IT ──────────────────────────────────────────────────────
async function main() {
  console.log(`Testing with YOUR_REFERENCE placed under data.${FIELD_TO_TEST}`);
  console.log("Payload:", rawBody);

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nexapay-signature": signature,
      "x-nexapay-timestamp": timestamp,
      "x-nexapay-event-id": eventId,
      "x-nexapay-event": "deposit.received",
      "x-nexapay-business-id": "test-business-id",
    },
    body: rawBody,
  });

  const text = await res.text();
  console.log(`\nResponse status: ${res.status}`);
  console.log("Response body:", text);
}

main().catch((err) => {
  console.error("Request failed:", err.message);
});