/**
 * services/paymentProviders/index.js
 * ─────────────────────────────────────
 * Pluggable payment-provider registry.
 *
 * TO ADD A NEW PROVIDER LATER (e.g. Flutterwave, Stripe):
 *   1. Create services/paymentProviders/flutterwave.js exporting
 *      an async verifyPayment(reference) => { success, amount, currency, ... }
 *   2. Register it below in the PROVIDERS map.
 *   Nothing in clinics.js or anywhere else needs to change.
 *
 * Every provider module must export a single function:
 *   async function verifyPayment(reference) => {
 *     success: boolean,
 *     amount: number,      // amount paid, in the smallest currency unit or NGN — be consistent
 *     currency: string,
 *     raw: object,         // full provider response, for logging/debugging
 *   }
 * On failure (invalid/unpaid/not-found reference), return { success: false, raw }
 * rather than throwing, so the caller can return a clean 400 to the client.
 */

const customProvider = require("./customProvider");
// const paystack = require("./paystack");           // add if/when you also support Paystack
// const flutterwave = require("./flutterwave");      // add if/when you also support Flutterwave

const PROVIDERS = {
  customProvider,
  // paystack,
  // flutterwave,
};

async function verifyPayment(providerName, reference) {
  const provider = PROVIDERS[providerName];
  if (!provider) {
    return {
      success: false,
      error: `Unknown payment provider: "${providerName}". Available: ${Object.keys(PROVIDERS).join(", ")}`,
    };
  }

  try {
    return await provider.verifyPayment(reference);
  } catch (err) {
    return {
      success: false,
      error: `Payment verification failed: ${err.message}`,
    };
  }
}

module.exports = { verifyPayment, PROVIDERS };