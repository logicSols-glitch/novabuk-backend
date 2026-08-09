/**
 * services/paymentProviders/nexapay.js
 * ───────────────────────────────────────
 * NexaPay integration for clinic subscription payments — Feature:
 * automated plan upgrade/renewal via bank transfer to a dedicated
 * virtual account, confirmed by NexaPay's webhook instead of a human
 * checking a bank statement (see routes/webhooksNexapay.js).
 *
 * Docs: https://docs.nexapay.ng
 *
 * REQUIRED ENV VARS:
 *   NEXAPAY_ BUSINESS_ID       — optional (see createVirtualAccount below —
 *                                 NexaPay support says it isn't required,
 *                                 likely because the API key is already
 *                                 business-scoped; sent if set, omitted if not)
 *   NEXAPAY_API_KEY_PROD       — starts with "nexa-prod-"
 *   NEXAPAY_API_KEY_TEST       — starts with "nexa-test-"
 *   NEXAPAY_ENV                — "production" or "test" (defaults to "test"
 *                                 so a misconfigured deploy fails safe —
 *                                 sandbox money, not live)
 *   NEXAPAY_WEBHOOK_SECRET     — from the merchant dashboard, used to verify
 *                                 inbound webhook signatures. NOT the API key.
 *
 * NexaPay determines live-vs-sandbox purely from WHICH key you send
 * (nexa-prod-... vs nexa-test-...), not from your own NODE_ENV — so
 * NEXAPAY_ENV is what picks the key, and it's deliberately separate
 * from NODE_ENV in case you ever want to smoke-test the prod key from
 * a staging deploy.
 */

const crypto = require("crypto");

const BASE_URL = process.env.NEXAPAY_BASE_URL || "https://api.nexapay.ng/api/v1";

// function getApiKey() {
//   const useProd = (process.env.NEXAPAY_ENV || "test").toLowerCase() === "production";
//   const key = useProd ? process.env.NEXAPAY_API_KEY_PROD : process.env.NEXAPAY_API_KEY_TEST;
//   if (!key) {
//     throw new Error(
//       `[nexapay] Missing ${useProd ? "NEXAPAY_API_KEY_PROD" : "NEXAPAY_API_KEY_TEST"} env var.`
//     );
//   }
//   return key;
// }

function getApiKey() {
  const useProd = (process.env.NEXAPAY_ENV || "test").toLowerCase() === "production";
  const key = useProd ? process.env.NEXAPAY_API_KEY_PROD : process.env.NEXAPAY_API_KEY_TEST;
  console.log(`[DEBUG nexapay] useProd=${useProd} keyLength=${key?.length} keyPreview="${key?.slice(0, 12)}...${key?.slice(-4)}"`);
  if (!key) {
    throw new Error(
      `[nexapay] Missing ${useProd ? "NEXAPAY_API_KEY_PROD" : "NEXAPAY_API_KEY_TEST"} env var.`
    );
  }
  return key;
}

// ── CREATE VIRTUAL ACCOUNT ─────────────────────────────────────
/**
 * Creates a dedicated account number for one subscription payment.
 * The clinic transfers into this account; NexaPay's deposit.received
 * webhook (see routes/webhooksNexapay.js) tells us when it lands.
 *
 * `reference` should be the same NVB-SUB-... value stored on the
 * SubscriptionPayment row — it's what lets the webhook find its way
 * back to the right record without any manual matching.
 *
 * validityTime and amountValidation are passed through exactly as
 * shown in NexaPay's own example — their meaning/units aren't spelled
 * out in the docs (is validityTime minutes? seconds?). Worth
 * confirming with NexaPay support or a sandbox test before relying on
 * the account expiring when you expect it to; until then this is a
 * reasonable guess (1440 = 24h, assuming minutes), not a documented fact.
 */
async function createVirtualAccount({ clinic, amount, reference }) {
  // NexaPay's own docs example includes businessId in the request
  // body, but their support has said it isn't actually required —
  // most likely because the API key itself is already scoped to one
  // business, making this redundant. Given that conflict, this stays
  // optional rather than a hard requirement: send it if configured,
  // omit it if not, so neither answer (docs vs support) breaks the
  // request. Worth asking NexaPay to confirm specifically for THIS
  // endpoint (POST /business/virtual-account/create) if you want a
  // definitive answer rather than this hedge.
  const businessId = process.env.NEXAPAY_BUSINESS_ID || undefined;

  const body = {
    businessId,
    amount,
    reference,
    merchantCustomerId: clinic._id.toString(),
    merchantReference: reference,
    customerName: clinic.name,
    customerEmail: clinic.contactEmail || undefined,
    customerPhone: clinic.contactPhone || undefined,
    metadata: {
      purpose: "subscription_payment",
      clinicId: clinic._id.toString(),
    },
    // ASSUMPTION — see note above. Confirm units before relying on this.
    validityTime: "1440",
    amountValidation: "A3",
  };

  const res = await fetch(`${BASE_URL}/business/virtual-account/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getApiKey(),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(`[nexapay] Virtual account creation failed: ${data.msg || res.statusText}`);
  }

  return {
    accountNumber: data.accountNumber,
    // NexaPay's documented response doesn't include a bank name field
    // at all — confirmed against their actual docs, not an oversight
    // here. VFD Microfinance Bank is the real, confirmed bank behind
    // every NexaPay virtual account, so that's the default — but still
    // deferring to data.bankName first, in case NexaPay ever starts
    // returning it directly (e.g. if they add multi-bank support later).
    bankName: data.bankName || data.virtualAccount?.bankName || "VFD Microfinance Bank",
    providerTransactionId: data.transactionId,
    environment: data.environment,
    raw: data,
  };
}

// ── WEBHOOK SIGNATURE VERIFICATION ─────────────────────────────
/**
 * NexaPay's docs say the signature is "computed over the raw body
 * plus timestamp" via HMAC SHA-256, but don't specify the exact
 * concatenation format or encoding. This implementation assumes
 * `HMAC_SHA256(secret, timestamp + "." + rawBody)`, hex-encoded —
 * a common convention (Stripe/Paystack-style), but NOT confirmed
 * against NexaPay's actual implementation.
 *
 * BEFORE GOING LIVE: trigger a real webhook from the NexaPay sandbox
 * (e.g. a test-mode virtual account deposit) and check this function
 * returns true against the real `x-nexapay-signature` header. If it
 * doesn't, this is the only place that needs to change — try
 * `rawBody + timestamp` (reversed order), or no separator, or
 * base64 instead of hex, until it matches.
 *
 * rawBody must be the exact bytes NexaPay sent (before any JSON
 * parsing) — see routes/webhooksNexapay.js, which uses express.raw()
 * specifically so this function gets the untouched body.
 */
function verifyWebhookSignature(rawBody, timestamp, signature) {
  const secret = process.env.NEXAPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("[nexapay] Missing NEXAPAY_WEBHOOK_SECRET env var.");
  if (!signature || !timestamp) return false;

  const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${bodyString}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");

  // Lengths can differ if the format assumption above is wrong — guard
  // before timingSafeEqual, which throws (rather than returning false)
  // on mismatched buffer lengths.
  if (expectedBuf.length !== signatureBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

module.exports = { createVirtualAccount, verifyWebhookSignature };