/**
 * services/subscriptionService.js
 * ───────────────────────────────────
 * Shared logic for activating a clinic's plan once a SubscriptionPayment
 * is verified — used by routes/webhooksNexapay.js (automatic) and
 * should also be called from wherever your existing MANUAL admin-review
 * route lives, so both provider paths activate a plan the exact same
 * way. That route wasn't available to wire up directly here — import
 * `activateClinicPlan` from there once it's shared.
 */

const { getPlan } = require("../config/plans");
const { getNextSequence } = require("../models/Counter");

// ── REFERENCE NUMBER (atomic — same pattern as billingService's
// receipt numbers, see models/Counter.js) ──────────────────────
// Format: NVB-SUB-[YEAR][MONTH]-[SEQUENCE], e.g. NVB-SUB-202606-00012.
async function getNextSubscriptionReference() {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const counterName = `subscription-${yearMonth}`;

  const sequence = await getNextSequence(counterName);
  return `NVB-SUB-${yearMonth}-${String(sequence).padStart(5, "0")}`;
}

// ── AMOUNT FOR A PLAN + BILLING CYCLE ───────────────────────────
// ANNUAL is the full year charged upfront (priceAnnual is "per month
// when billed annually" per config/plans.js), matching the pricing
// page: Growth annual = priceAnnual * 12.
function amountForPlan(planKey, billingCycle) {
  const plan = getPlan(planKey);
  if (!plan) throw new Error(`Unknown plan "${planKey}".`);
  if (billingCycle === "ANNUAL") return plan.priceAnnual * 12;
  return plan.priceMonthly;
}

// ── ACTIVATE / RENEW A CLINIC'S PLAN ────────────────────────────
/**
 * Called once a payment (any provider) is confirmed. If the clinic's
 * current subscription hasn't expired yet, extends from the existing
 * expiry rather than from now — so renewing a few days early never
 * costs the clinic those remaining days. A plan change (e.g. Growth
 * -> Pro) or a lapsed subscription starts the new period from now.
 */
async function activateClinicPlan({ clinic, plan, billingCycle }) {
  const now = new Date();
  const stillActive =
    clinic.subscriptionStatus === "Active" &&
    clinic.subscriptionExpiry &&
    clinic.subscriptionExpiry > now &&
    clinic.subscriptionPlan === plan;

  const startFrom = stillActive ? clinic.subscriptionExpiry : now;
  const expiry = new Date(startFrom);
  if (billingCycle === "ANNUAL") {
    expiry.setFullYear(expiry.getFullYear() + 1);
  } else {
    expiry.setMonth(expiry.getMonth() + 1);
  }

  clinic.subscriptionPlan = plan;
  clinic.subscriptionStatus = "Active";
  clinic.subscriptionExpiry = expiry;
  await clinic.save();

  return clinic;
}

module.exports = {
  getNextSubscriptionReference,
  amountForPlan,
  activateClinicPlan,
  getEffectiveStatus,
  getReactivationCTA,
};

// ── EFFECTIVE PLAN STATUS ────────────────────────────────────────
/**
 * Feature 3 (Free Degraded Tier) calls for a daily cron that flips a
 * clinic to FREE_TIER status at day 60 of its trial. That's a real
 * design choice worth naming explicitly: a stored field kept in sync
 * by a cron can drift — if the cron is late, fails silently one day,
 * or a clinic's admin manually edits subscriptionExpiry, the stored
 * status is wrong until the next run, and every enforcement check in
 * the meantime is either too strict or (worse) too permissive.
 *
 * This computes the clinic's effective status fresh on every call
 * instead, from fields that are already the source of truth
 * (trialEndsAt, subscriptionStatus, subscriptionExpiry,
 * subscriptionPlan) — so it can never be stale. There's no
 * reset/flip cron to run or monitor; correctness falls out of the
 * math instead of depending on a background job having run recently.
 *
 * Order matches the spec exactly: TRIAL → FREE_TIER → BASIC → PREMIUM.
 *   TRIAL   — still inside the 60-day trial window
 *   PREMIUM — Active subscription, not expired, plan is Pro
 *   BASIC   — Active subscription, not expired, plan is Growth
 *   FREE_TIER — everything else: trial over AND no active paid plan
 *               (never subscribed, subscription lapsed, or was
 *               manually deactivated — all collapse to the same
 *               degraded state, which is the correct behavior either way)
 */
function getEffectiveStatus(clinic) {
  const now = new Date();

  if (clinic.trialEndsAt && clinic.trialEndsAt > now) {
    return "TRIAL";
  }

  const hasActiveSubscription =
    clinic.subscriptionStatus === "Active" &&
    clinic.subscriptionExpiry &&
    clinic.subscriptionExpiry > now;

  if (hasActiveSubscription) {
    return clinic.subscriptionPlan === "Pro" ? "PREMIUM" : "BASIC";
  }

  return "FREE_TIER";
}

// ── "RENEW" VS "SUBSCRIBE/UPGRADE" WORDING ───────────────────────
/**
 * Both middleware/enforceFreeTierLimit.js and middleware/planGate.js
 * need to tell a blocked FREE_TIER clinic what to do next — but the
 * right verb depends on whether they've EVER actually paid before.
 *
 * clinic.subscriptionPlan is NOT a reliable signal for this: it
 * defaults to "Growth" for every clinic, including ones that never
 * paid anything (still on trial, or trial expired with no payment
 * ever made) — so a never-subscribed clinic and a lapsed-Growth
 * clinic look identical on that field alone. Worse, if a clinic that
 * paid for PRO lets it lapse, subscriptionPlan still says "Pro"
 * forever (nothing resets it) — so telling them "Upgrade to Growth"
 * reads as suggesting a downgrade to someone who already had the
 * better plan.
 *
 * This checks actual payment history instead — a VERIFIED
 * SubscriptionPayment existing at all means they've paid before,
 * regardless of which plan or whether it's since lapsed:
 *   - Ever paid before  -> "Renew" (their subscription lapsed)
 *   - Never paid before -> "Subscribe" (this is their first time)
 */
async function getReactivationCTA(clinicId) {
  const SubscriptionPayment = require("../models/SubscriptionPayment"); // lazy require — avoids a circular require with models/SubscriptionPayment.js if it ever imports from here
  const hasSubscribedBefore = await SubscriptionPayment.exists({
    clinic: clinicId,
    status: "VERIFIED",
  });

  return hasSubscribedBefore
    ? { verb: "Renew", label: "Renew Subscription" }
    : { verb: "Subscribe", label: "Subscribe Now" };
}