/**
 * routes/webhooksNexapay.js
 * ────────────────────────────
 * Receives NexaPay's `deposit.received` webhook and auto-verifies +
 * activates the matching SubscriptionPayment, no admin step needed.
 *
 * ⚠️ MOUNTING REQUIREMENT: this router needs the RAW request body to
 * verify the HMAC signature — by the time express.json() has parsed
 * it, the original bytes are gone and any signature check against a
 * re-serialized JSON.stringify() would silently be wrong (key order,
 * whitespace, etc. can all differ from what NexaPay actually signed).
 * So in server.js, mount this router BEFORE app.use(express.json()):
 *
 *   app.use("/api/webhooks/nexapay", require("./routes/webhooksNexapay"));
 *   app.use(express.json());   // <- must come after the line above
 *
 * Full webhook URL to configure in the NexaPay dashboard:
 *   https://<your-api-domain>/api/webhooks/nexapay
 */

const express = require("express");
const router = express.Router();

const { verifyWebhookSignature } = require("../services/paymentProviders/nexapay");
const { activateClinicPlan } = require("../services/subscriptionService");
const {
  sendSubscriptionActivatedEmail,
  sendSubscriptionPaymentRejectedEmail,
} = require("../services/emailService");
const SubscriptionPayment = require("../models/SubscriptionPayment");
const Clinic = require("../models/Clinic");

// Raw body ONLY for this router — express.raw() gives req.body as a
// Buffer instead of parsing it, which is exactly what signature
// verification needs.
router.use(express.raw({ type: "*/*" }));

router.post("/", async (req, res) => {
  const rawBody = req.body; // Buffer
  const signature = req.headers["x-nexapay-signature"];
  const timestamp = req.headers["x-nexapay-timestamp"];
  const eventId = req.headers["x-nexapay-event-id"];
  const eventName = req.headers["x-nexapay-event"];

  if (!signature || !timestamp || !eventId) {
    return res.status(401).json({ success: false, message: "Missing webhook headers." });
  }

  let isValid;
  try {
    isValid = verifyWebhookSignature(rawBody, timestamp, signature);
  } catch (err) {
    // Misconfiguration (e.g. missing NEXAPAY_WEBHOOK_SECRET) — this is
    // OUR bug, not a bad delivery, so 500 so NexaPay retries once it's fixed.
    console.error("[webhooksNexapay] Signature verification errored:", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }

  if (!isValid) {
    console.warn(`[webhooksNexapay] Rejected webhook ${eventId} — signature mismatch.`);
    return res.status(401).json({ success: false, message: "Invalid signature." });
  }

  console.log("[RAW WEBHOOK] headers:", JSON.stringify(req.headers));
  console.log("[RAW WEBHOOK] rawBody:", rawBody.toString("utf8"));

  let body;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    return res.status(400).json({ success: false, message: "Malformed JSON body." });
  }

  // Only deposit.received matters for subscription payments — ack and
  // ignore withdrawal.* events (those relate to NovaBuk's own payouts,
  // not clinic payments in).
  if (eventName !== "deposit.received" || body.event !== "deposit.received") {
    return res.status(200).json({ success: true, ignored: true });
  }

  try {
    // Idempotency — a redelivered/retried webhook must never
    // double-activate a plan.
    const alreadyProcessed = await SubscriptionPayment.findOne({ webhookEventId: eventId });
    if (alreadyProcessed) {
      return res.status(200).json({ success: true, duplicate: true });
    }

    // const { data } = body;
    // const payment = await SubscriptionPayment.findOne({
    //   reference: data.reference,
    //   provider: "NEXAPAY",
    //   status: "PENDING",
    // });

    const { data } = body;
    const payment = await SubscriptionPayment.findOne({
      reference: data.merchantReference,
      provider: "NEXAPAY",
      status: "PENDING",
    });

    if (!payment) {
      // Nothing pending matches this reference — could be an already-
      // handled payment, a stray/unexpected deposit, or a reference
      // mismatch. Log for manual investigation but ack the webhook;
      // NexaPay retrying forever won't make a missing record appear.
      // console.warn(`[webhooksNexapay] No matching PENDING payment for reference "${data.reference}".`);
      console.warn(`[webhooksNexapay] No matching PENDING payment for merchantReference "${data.merchantReference}".`);
      return res.status(200).json({ success: true, matched: false });
    }

    // Fetched once here since both branches below need it — the
    // rejected path just for the clinic's name in the email, the
    // verified path also to actually activate the plan on it.
    const clinic = await Clinic.findById(payment.clinic);
    const notifyEmail = payment.submittedByEmail || clinic?.contactEmail;
    const clinicName = clinic?.name || "your clinic";

    if (data.status !== "successful" || Number(data.amount) !== payment.amount) {
      payment.status = "REJECTED";
      payment.reviewedByName = "NexaPay (auto)";
      payment.reviewedAt = new Date();
      payment.reviewNote =
        data.status !== "successful"
          ? `Deposit status was "${data.status}", not "successful".`
          : `Amount mismatch: expected ${payment.amount}, received ${data.amount}.`;
      payment.webhookEventId = eventId;
      await payment.save();

      console.error(
        `[webhooksNexapay] Payment ${payment.reference} rejected — ${payment.reviewNote}`
      );

      // Best-effort — a failed email should never turn an already-
      // processed webhook into a retry (idempotency above would then
      // just find alreadyProcessed and short-circuit anyway, but no
      // reason to make NexaPay re-send over an email hiccup).
      if (notifyEmail) {
        sendSubscriptionPaymentRejectedEmail({
          to: notifyEmail,
          clinicName,
          plan: payment.plan,
          amount: payment.amount,
          reference: payment.reference,
          reason: payment.reviewNote,
        }).catch((err) =>
          console.error(`[webhooksNexapay] Rejection email failed for ${payment.reference}:`, err.message)
        );
      }

      return res.status(200).json({ success: true, matched: true, rejected: true });
    }

    if (!clinic) {
      console.error(`[webhooksNexapay] Clinic ${payment.clinic} not found for payment ${payment.reference}.`);
      return res.status(200).json({ success: true, matched: true, clinicMissing: true });
    }

    payment.status = "VERIFIED";
    payment.verifiedVia = "WEBHOOK_AUTO";
    payment.reviewedByName = "NexaPay (auto)";
    payment.reviewedAt = new Date();
    payment.reviewNote = `Auto-verified via NexaPay webhook (${eventId}).`;
    payment.providerTransactionId = data.transactionId || payment.providerTransactionId;
    payment.webhookEventId = eventId;
    await payment.save();

    await activateClinicPlan({ clinic, plan: payment.plan, billingCycle: payment.billingCycle });

    if (notifyEmail) {
      sendSubscriptionActivatedEmail({
        to: notifyEmail,
        clinicName,
        plan: payment.plan,
        billingCycle: payment.billingCycle,
        amount: payment.amount,
        expiryDate: clinic.subscriptionExpiry,
        reference: payment.reference,
      }).catch((err) =>
        console.error(`[webhooksNexapay] Activation email failed for ${payment.reference}:`, err.message)
      );
    }

    console.log(`[webhooksNexapay] Activated ${payment.plan} for clinic ${clinic._id} (payment ${payment.reference}).`);
    return res.status(200).json({ success: true, matched: true, activated: true });
  } catch (error) {
    // Unexpected failure (DB hiccup, etc.) — 500 so NexaPay retries,
    // since idempotency above makes a retry safe.
    console.error("[webhooksNexapay] Processing error:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;