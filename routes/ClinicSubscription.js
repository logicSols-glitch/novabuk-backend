/**
 * routes/clinicSubscription.js
 * ────────────────────────────────
 * Clinic-portal-facing routes for paying/upgrading a subscription via
 * NexaPay. Mount at /api/clinic in server.js (alongside your other
 * clinic-* route files) — the full paths become:
 *
 *   POST /api/clinic/subscription/initiate
 *   GET  /api/clinic/subscription/history
 *   GET  /api/clinic/subscription/status/:reference
 *
 * Billing & subscription settings is Clinic-Admin-only per the RBAC
 * table (owner or a delegated ClinicStaff "admin") — requireRole()
 * with no extra roles listed enforces exactly that, since only the
 * owner/admin bypass can pass.
 */

const express = require("express");
const router = express.Router();

const { protectClinicPortal } = require("../middleware/protectClinicPortal");
const { requireRole } = require("../middleware/requireRole");
const { isValidPlan } = require("../config/plans");
const { getNextSubscriptionReference, amountForPlan } = require("../services/subscriptionService");
const { createVirtualAccount } = require("../services/paymentProviders/nexapay");
const Clinic = require("../models/Clinic");
const SubscriptionPayment = require("../models/SubscriptionPayment");

// ─────────────────────────────────────────────────────────────
// POST /subscription/initiate
// Body: { plan: "Growth"|"Pro", billingCycle: "MONTHLY"|"ANNUAL" }
// Creates a dedicated NexaPay virtual account and a PENDING
// SubscriptionPayment row. Returns the account details for the
// frontend to display so the clinic can make the transfer.
// ─────────────────────────────────────────────────────────────
router.post("/subscription/initiate", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    const { plan, billingCycle } = req.body;

    if (!isValidPlan(plan)) {
      return res.status(400).json({ success: false, message: `Unknown plan "${plan}".` });
    }
    if (!["MONTHLY", "ANNUAL"].includes(billingCycle)) {
      return res.status(400).json({
        success: false,
        message: 'billingCycle must be "MONTHLY" or "ANNUAL".',
      });
    }

    const clinic = await Clinic.findById(req.actor.clinicId);
    if (!clinic) {
      return res.status(404).json({ success: false, message: "Clinic not found." });
    }

    const amount = amountForPlan(plan, billingCycle);
    const reference = await getNextSubscriptionReference();

    const account = await createVirtualAccount({ clinic, amount, reference });

    const payment = await SubscriptionPayment.create({
      clinic: clinic._id,
      plan,
      billingCycle,
      amount,
      reference,
      provider: "NEXAPAY",
      accountNumber: account.accountNumber,
      bankName: account.bankName,
      providerTransactionId: account.providerTransactionId,
      status: "PENDING",
      submittedById: req.actor.id,
      submittedByType: req.actor.isOwner ? "User" : "ClinicStaff",
    });

    res.status(201).json({
      success: true,
      message: "Transfer to the account below to complete your upgrade.",
      data: {
        reference,
        amount,
        plan,
        billingCycle,
        accountNumber: account.accountNumber,
        bankName: account.bankName,
        paymentId: payment._id,
      },
    });
  } catch (error) {
    console.error("[clinicSubscription] initiate error:", error.message);
    res.status(500).json({ success: false, message: "Could not start payment. Please try again." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /subscription/history
// Billing settings page — list of past subscription payments for
// this clinic (both MANUAL and NEXAPAY rows), newest first.
// ─────────────────────────────────────────────────────────────
router.get("/subscription/history", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    const payments = await SubscriptionPayment.find({ clinic: req.actor.clinicId }).sort({
      createdAt: -1,
    });
    res.json({ success: true, data: payments });
  } catch (error) {
    console.error("[clinicSubscription] history error:", error.message);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /subscription/status/:reference
// Lightweight poll target for the checkout modal while it waits on
// the NexaPay webhook — deliberately scoped to req.actor.clinicId so
// one clinic can't probe another clinic's payment references.
// ─────────────────────────────────────────────────────────────
router.get("/subscription/status/:reference", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    const payment = await SubscriptionPayment.findOne({
      reference: req.params.reference,
      clinic: req.actor.clinicId,
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment not found." });
    }

    res.json({
      success: true,
      data: {
        status: payment.status,
        plan: payment.plan,
        billingCycle: payment.billingCycle,
        reviewNote: payment.reviewNote,
      },
    });
  } catch (error) {
    console.error("[clinicSubscription] status error:", error.message);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;