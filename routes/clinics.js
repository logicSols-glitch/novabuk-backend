const express = require("express");
const router = express.Router();
const Clinic = require("../models/Clinic");
const { protectUser } = require("../middleware/authUser");
const { protectDoctor } = require("../middleware/authDoctor.js");
const { protectClinicPortal } = require("../middleware/protectClinicPortal");
const { requireRole } = require("../middleware/requireRole");
const { protectAdmin, requireAdminRole } = require("../middleware/auth");
const User = require("../models/User");
const Visit = require("../models/Visit");

// ─────────────────────────────────────────────
// GET /api/clinics
// Public — list all active clinics
// ─────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { search, service, city, isOpen } = req.query;

    const filter = { isActive: true };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { "location.city": { $regex: search, $options: "i" } },
        { "location.address": { $regex: search, $options: "i" } },
      ];
    }

    if (service) {
      filter.services = { $in: [new RegExp(service, "i")] };
    }

    if (city) {
      filter["location.city"] = { $regex: city, $options: "i" };
    }

    if (isOpen !== undefined) {
      filter.isOpen = isOpen === "true";
    }

    const clinics = await Clinic.find(filter).sort({ name: 1 });

    res.json({
      success: true,
      count: clinics.length,
      data: clinics,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/clinics/plans
// Public — subscription plan pricing, read straight from
// config/plans.js (the single source of truth for pricing). The
// clinic settings "Upgrade" card fetches this instead of hardcoding
// numbers, so the price shown can never drift from what actually
// gets charged.
// MUST come before /:id (see note below) so "plans" isn't swallowed
// as a Mongo ObjectId param.
// ─────────────────────────────────────────────
router.get("/plans", (req, res) => {
  const { PLANS } = require("../config/plans");

  const data = Object.entries(PLANS).map(([key, plan]) => ({
    key,
    displayName: plan.displayName,
    priceMonthly: plan.priceMonthly,
    priceAnnual: plan.priceAnnual, // per month, when billed annually
    priceAnnualTotal: plan.priceAnnual != null ? plan.priceAnnual * 12 : null, // charged upfront
  }));

  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════
// DOCTOR SELF-SERVICE ROUTES
// IMPORTANT: These MUST come BEFORE /:id so Express does not
// treat the string "my" or "register" as a Mongo ObjectId.
// ═══════════════════════════════════════════════════════════════

// POST /api/clinics/register
// Called from clinic-register.html after doctor signs up.
router.post("/register", protectDoctor, async (req, res) => {
  try {
    const { name, address, city, state, phone, email, services, plan } = req.body;

    if (!name || !address || !city || !phone) {
      return res.status(400).json({
        success: false,
        message: "Clinic name, address, city and phone are required.",
      });
    }

    if (req.user.clinicId) {
      return res.status(400).json({
        success: false,
        message: "You already have a clinic registered.",
        clinicId: req.user.clinicId,
      });
    }

    // Plan is chosen at registration. Validated against config/plans.js —
    // the single source of truth for what plans exist. Defaults to
    // "Growth" if omitted or invalid, rather than rejecting the request,
    // since plan choice is a soft preference at signup, not a hard
    // requirement. No billing enforced yet; trialEndsAt is set
    // automatically (60 days) regardless of plan chosen.
    const { isValidPlan } = require("../config/plans");
    const chosenPlan = isValidPlan(plan) ? plan : "Growth";

    const clinic = await Clinic.create({
      name: name.trim(),
      location: {
        address: address.trim(),
        city: city.trim(),
        state: state?.trim() || "",
      },
      contactPhone: phone.trim(),
      contactEmail: email?.trim() || "",
      services: Array.isArray(services) ? services : [],
      isOpen: true,
      isActive: true,
      subscriptionPlan: chosenPlan,
      // trialEndsAt uses the schema default (60 days from now) automatically
    });

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { clinicId: clinic._id, clinicName: clinic.name },
      { new: true },
    ).select("-password");

    const { sendDoctorWelcomeEmail } = require("../services/emailService");
    sendDoctorWelcomeEmail({
      to: req.user.email,
      doctorName: req.user.fullName,
      clinicName: clinic.name,
    }).catch((err) =>
      console.error("Doctor welcome email failed:", err.message),
    );

    res.status(201).json({
      success: true,
      message: "Clinic registered successfully.",
      clinic: {
        id: clinic._id,
        name: clinic.name,
        subscriptionPlan: clinic.subscriptionPlan,
        trialEndsAt: clinic.trialEndsAt,
      },
      user: {
        id: updatedUser._id,
        fullName: updatedUser.fullName,
        email: updatedUser.email,
        role: updatedUser.role,
        avatarUrl: updatedUser.avatarUrl,
        profileComplete: updatedUser.profileComplete,
        clinicId: updatedUser.clinicId,
        clinicName: updatedUser.clinicName,
      },
    });
  } catch (error) {
    console.error("Clinic register error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// GET /api/clinics/my — doctor fetches their own clinic
router.get("/my", protectClinicPortal, async (req, res) => {
  try {
    if (!req.actor.clinicId) {
      return res.status(400).json({
        success: false,
        message: "No clinic linked to your account.",
      });
    }
    const clinic = await Clinic.findById(req.actor.clinicId);
    if (!clinic) {
      return res
        .status(404)
        .json({ success: false, message: "Clinic not found." });
    }
    res.json({ success: true, clinic });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// PATCH /api/clinics/my — update clinic settings.
// Owner or delegated ClinicStaff "admin" only — per Feature 1's matrix,
// "Clinic settings" is a Clinic Admin duty, not something every staff
// member (doctor/nurse/receptionist/etc.) should be able to change.
router.patch("/my", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    if (!req.actor.clinicId) {
      return res.status(400).json({
        success: false,
        message: "No clinic linked to your account.",
      });
    }

    const { name, location, contactPhone, contactEmail, services, image, isOpen, openingHours } = req.body;
    const baseVersion = req.header('X-Base-Version');

    // ── CONFLICT GUARD ─────────────────────────────────────────
    if (baseVersion) {
        const existingClinic = await Clinic.findById(req.actor.clinicId);
        if (existingClinic && existingClinic.updatedAt) {
            const clientTime = new Date(baseVersion).getTime();
            const serverTime = new Date(existingClinic.updatedAt).getTime();
            
            // If server has a newer update than what the client saw
            if (serverTime > clientTime + 1000) { // +1s buffer for safety
                return res.status(409).json({
                    success: false,
                    message: "CONFLICT: This clinic profile was updated by someone else while you were offline. Please refresh to see the latest changes.",
                    conflict: true
                });
            }
        }
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (location !== undefined) updates.location = location;
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;
    if (contactEmail !== undefined) updates.contactEmail = contactEmail;
    if (services !== undefined) updates.services = services;
    if (image !== undefined) updates.image = image;
    if (isOpen !== undefined) updates.isOpen = isOpen;
    if (openingHours !== undefined) updates.openingHours = openingHours;


    const clinic = await Clinic.findByIdAndUpdate(req.actor.clinicId, updates, {
      new: true,
      runValidators: true,
    });

    if (!clinic) {
      return res
        .status(404)
        .json({ success: false, message: "Clinic not found." });
    }

    if (name && name !== req.user.clinicName) {
      await User.findByIdAndUpdate(req.user._id, { clinicName: clinic.name });
    }

    res.json({
      success: true,
      message: "Clinic profile updated.",
      clinic
    });
  } catch (error) {
    console.error("Clinic update error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// POST /api/clinics/seed
// Dev only — seed test clinic data
// ─────────────────────────────────────────────
router.post("/seed", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res
      .status(403)
      .json({ success: false, message: "Not allowed in production." });
  }

  try {
    await Clinic.deleteMany({});

    const clinics = await Clinic.insertMany([
      {
        name: "Lagos University Teaching Hospital Clinic",
        location: {
          address: "Idi-Araba, Surulere",
          city: "Lagos",
          state: "Lagos State",
          coordinates: { lat: 6.5099, lng: 3.3588 },
        },
        contactPhone: "+234 1 774 0000",
        contactEmail: "luth@health.ng",
        isOpen: true,
        openingHours: {
          monday: { open: "08:00", close: "17:00" },
          tuesday: { open: "08:00", close: "17:00" },
          wednesday: { open: "08:00", close: "17:00" },
          thursday: { open: "08:00", close: "17:00" },
          friday: { open: "08:00", close: "17:00" },
          saturday: { open: "09:00", close: "14:00" },
          sunday: { open: null, close: null },
        },
        services: ["General Practice", "Lab Tests", "Pharmacy", "Emergency"],
      },
      {
        name: "NovaBuk Campus Health Centre",
        location: {
          address: "University Road, Yaba",
          city: "Lagos",
          state: "Lagos State",
          coordinates: { lat: 6.5158, lng: 3.3794 },
        },
        contactPhone: "+234 803 000 0001",
        contactEmail: "campus@novabuk.com",
        isOpen: true,
        openingHours: {
          monday: { open: "07:00", close: "19:00" },
          tuesday: { open: "07:00", close: "19:00" },
          wednesday: { open: "07:00", close: "19:00" },
          thursday: { open: "07:00", close: "19:00" },
          friday: { open: "07:00", close: "19:00" },
          saturday: { open: "08:00", close: "16:00" },
          sunday: { open: "10:00", close: "14:00" },
        },
        services: ["General Practice", "Mental Health", "Prescriptions"],
      },
      {
        name: "Abuja District Wellness Clinic",
        location: {
          address: "Wuse Zone 3",
          city: "Abuja",
          state: "FCT",
          coordinates: { lat: 9.0765, lng: 7.3986 },
        },
        contactPhone: "+234 803 000 0002",
        contactEmail: "abuja@novabuk.com",
        isOpen: false,
        openingHours: {
          monday: { open: "08:00", close: "18:00" },
          tuesday: { open: "08:00", close: "18:00" },
          wednesday: { open: "08:00", close: "18:00" },
          thursday: { open: "08:00", close: "18:00" },
          friday: { open: "08:00", close: "18:00" },
          saturday: { open: null, close: null },
          sunday: { open: null, close: null },
        },
        services: ["General Practice", "Dental", "Eye Care", "Lab Tests"],
      },
    ]);

    res.json({
      success: true,
      message: `${clinics.length} clinics seeded.`,
      data: clinics,
    });
  } catch (error) {
    console.error("Seed error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/clinics/:id
// Public — get a single clinic by ID
// NOTE: Must come AFTER all named routes (/my, /register, /seed)
// ─────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const clinic = await Clinic.findById(req.params.id);

    if (!clinic || !clinic.isActive) {
      return res
        .status(404)
        .json({ success: false, message: "Clinic not found." });
    }

    res.json({ success: true, data: clinic });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// GET /api/clinics/admin/all
// Admin only — paginated, searchable clinic list for the dashboard.
// Kept as its own route (rather than adding page/limit to the public
// GET / above) so the patient-facing clinic directory's behavior and
// response shape is left completely untouched.
// ─────────────────────────────────────────────
router.get("/admin/all", protectAdmin, requireAdminRole("admin"), async (req, res) => {
  try {
    const { search, isActive, plan, page = 1, limit = 10 } = req.query;

    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { "location.city": { $regex: search, $options: "i" } },
        { "location.address": { $regex: search, $options: "i" } },
      ];
    }

    if (isActive !== undefined) {
      filter.isActive = isActive === "true";
    }

    if (plan) {
      filter.subscriptionPlan = plan;
    }

    const skip = (page - 1) * limit;

    const [clinics, total] = await Promise.all([
      Clinic.find(filter)
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Clinic.countDocuments(filter),
    ]);

    res.json({
      success: true,
      count: clinics.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      data: clinics,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST /api/clinics — add new clinic + doctor account (admin)
router.post("/", protectAdmin, requireAdminRole("admin"), async (req, res) => {
  try {
    const { 
      name, location, phone, email, services,
      doctorName, doctorEmail, doctorPassword 
    } = req.body;

    const address = location?.address;
    const city = location?.city;
    const state = location?.state;

    // 1. Basic validation
    if (!name || !address || !city || !doctorName || !doctorEmail || !doctorPassword) {
      return res.status(400).json({
        success: false,
        message: "Clinic name, address, city, and doctor account details are required.",
      });
    }

    // 2. Check if doctor email is already taken
    const existingUser = await User.findOne({ email: doctorEmail.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "A user with this email already exists.",
      });
    }

    // 3. Create the Clinic
    const clinic = await Clinic.create({
      name: name.trim(),
      location: {
        address: address.trim(),
        city: city.trim(),
        state: state?.trim() || "",
      },
      contactPhone: phone?.trim() || "",
      contactEmail: email?.trim() || "",
      services: Array.isArray(services) ? services : [],
      isOpen: true,
      isActive: true,
    });

    // 4. Create the Doctor User
    const doctor = await User.create({
      fullName: doctorName.trim(),
      email: doctorEmail.toLowerCase(),
      password: doctorPassword,
      role: "Doctors",
      clinicId: clinic._id,
      clinicName: clinic.name,
      profileComplete: true
    });

    res.status(201).json({
      success: true,
      message: "Clinic and Doctor account created successfully.",
      data: {
        clinic: { id: clinic._id, name: clinic.name },
        doctor: { id: doctor._id, fullName: doctor.fullName, email: doctor.email }
      }
    });
  } catch (error) {
    console.error("Admin add clinic error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// PUT /api/clinics/:id — edit clinic (admin)
router.put("/:id", protectAdmin, requireAdminRole("admin"), async (req, res) => {
  try {
    const clinic = await Clinic.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!clinic)
      return res
        .status(404)
        .json({ success: false, message: "Clinic not found." });
    res.json({ success: true, message: "Clinic updated.", data: clinic });
  } catch (error) {
    console.error("Update clinic error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// DELETE /api/clinics/:id — toggle active/inactive (admin)
router.delete("/:id", protectAdmin, requireAdminRole("admin"), async (req, res) => {
  try {
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic)
      return res
        .status(404)
        .json({ success: false, message: "Clinic not found." });
    clinic.isActive = !clinic.isActive;
    await clinic.save();
    res.json({
      success: true,
      message: `Clinic ${clinic.isActive ? "activated" : "deactivated"}.`,
      data: clinic,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// PATCH /api/clinics/:id/toggle — toggle open/closed (admin)
router.patch("/:id/toggle", protectAdmin, requireAdminRole("admin"), async (req, res) => {
  try {
    const { isOpen } = req.body;
    const clinic = await Clinic.findByIdAndUpdate(
      req.params.id,
      { isOpen },
      { new: true },
    );
    if (!clinic)
      return res
        .status(404)
        .json({ success: false, message: "Clinic not found." });
    res.json({
      success: true,
      message: `Clinic is now ${isOpen ? "Open" : "Closed"}.`,
      data: clinic,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// GET /api/clinics/admin/:id/stats — get clinic activity stats (admin)
router.get("/admin/:id/stats", protectAdmin, requireAdminRole("admin"), async (req, res) => {
  try {
    const clinicId = req.params.id;
    
    // Count all visits for this clinic
    const totalVisits = await Visit.countDocuments({ clinic: clinicId });
    
    // Count completed vs pending
    const completedVisits = await Visit.countDocuments({ clinic: clinicId, status: "Completed" });
    const pendingVisits = await Visit.countDocuments({ clinic: clinicId, status: "Pending" });
    const inProgressVisits = await Visit.countDocuments({ clinic: clinicId, status: "InProgress" });
    
    // Count unique patients
    const uniquePatients = await Visit.distinct("user", { clinic: clinicId });

    res.json({
      success: true,
      data: {
        totalVisits,
        completedVisits,
        pendingVisits,
        inProgressVisits,
        totalUniquePatients: uniquePatients.length
      }
    });
  } catch (error) {
    console.error("Clinic stats error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/clinics/subscription-payments
// MANUAL provider — clinic submits a claimed payment toward a plan
// upgrade after already sending a bank transfer outside the app;
// this records it for a NovaBuk admin to verify against their bank
// statement (see /admin/subscription-payments/:id/review below).
// Restricted to requireRole() with no args — only the clinic owner or
// a delegated ClinicStaff "admin" can initiate a subscription-related
// financial action, not general staff.
//
// (This file used to also have a POST /upgrade route — activated a
// plan directly off a client-supplied provider+reference with no
// SubscriptionPayment record at all, so it never showed up in
// billing history and used a flat 30-day expiry regardless of
// monthly/annual. Removed: nothing calls it anymore now that
// /subscription-payments (this route, MANUAL) and
// /subscription-payments/nexapay (NEXAPAY, auto-verified via
// webhook) exist with full audit trails. If something external still
// depends on POST /upgrade, that's the signal to restore it rather
// than assume.)
// ─────────────────────────────────────────────────────────────
router.post("/subscription-payments", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    if (!req.actor.clinicId) {
      return res.status(400).json({ success: false, message: "No clinic linked to your account." });
    }

    const { plan = "Pro", billingCycle = "MONTHLY", amount, paymentNote } = req.body;

    const { isValidPlan } = require("../config/plans");
    if (!isValidPlan(plan)) {
      return res.status(400).json({ success: false, message: `"${plan}" is not a valid plan.` });
    }
    if (!["MONTHLY", "ANNUAL"].includes(billingCycle)) {
      return res.status(400).json({ success: false, message: 'billingCycle must be "MONTHLY" or "ANNUAL".' });
    }
    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ success: false, message: "amount must be a positive number." });
    }

    const { getNextSubscriptionReference, amountForPlan } = require("../services/subscriptionService");
    const expectedAmount = amountForPlan(plan, billingCycle);
    if (amount < expectedAmount) {
      return res.status(400).json({
        success: false,
        message: `Amount (\u20a6${amount.toLocaleString()}) is less than the ${plan} ${billingCycle.toLowerCase()} price (\u20a6${expectedAmount.toLocaleString()}).`,
      });
    }

    const reference = await getNextSubscriptionReference();

    const SubscriptionPayment = require("../models/SubscriptionPayment");
    const payment = await SubscriptionPayment.create({
      clinic: req.actor.clinicId,
      plan,
      billingCycle,
      amount,
      reference,
      provider: "MANUAL",
      paymentNote: paymentNote || "",
      submittedById: req.actor.id,
      submittedByType: req.actor.isOwner ? "User" : "ClinicStaff",
      submittedByEmail: req.actor.email || "",
      submittedByName: req.actor.fullName || "",
    });

    res.status(201).json({
      success: true,
      message: `Submitted. Include reference ${reference} in your bank transfer narration so it can be matched and verified.`,
      data: payment,
    });
  } catch (error) {
    console.error("Submit subscription payment error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/clinics/subscription-payments/nexapay
// NEXAPAY provider — creates a dedicated virtual account for this
// upgrade and a matching PENDING SubscriptionPayment row. No admin
// review needed for this path: NexaPay's deposit.received webhook
// (routes/webhooksNexapay.js) confirms the transfer and activates the
// plan automatically the moment it lands.
// ─────────────────────────────────────────────────────────────
router.post("/subscription-payments/nexapay", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    const { plan, billingCycle = "MONTHLY" } = req.body;

    const { isValidPlan } = require("../config/plans");
    if (!isValidPlan(plan)) {
      return res.status(400).json({ success: false, message: `Unknown plan "${plan}".` });
    }
    if (!["MONTHLY", "ANNUAL"].includes(billingCycle)) {
      return res.status(400).json({ success: false, message: 'billingCycle must be "MONTHLY" or "ANNUAL".' });
    }

    const clinic = await Clinic.findById(req.actor.clinicId);
    if (!clinic) {
      return res.status(404).json({ success: false, message: "Clinic not found." });
    }

    const { getNextSubscriptionReference, amountForPlan } = require("../services/subscriptionService");
    const { createVirtualAccount } = require("../services/paymentProviders/nexapay");

    const amount = amountForPlan(plan, billingCycle);
    const reference = await getNextSubscriptionReference();
    const account = await createVirtualAccount({ clinic, amount, reference });

    const SubscriptionPayment = require("../models/SubscriptionPayment");
    const payment = await SubscriptionPayment.create({
      clinic: clinic._id,
      plan,
      billingCycle,
      amount,
      reference,
      provider: "NEXAPAY",
      accountNumber: account.accountNumber,
      bankName: account.bankName, // VFD Microfinance Bank — see nexapay.js
      providerTransactionId: account.providerTransactionId,
      status: "PENDING",
      submittedById: req.actor.id,
      submittedByType: req.actor.isOwner ? "User" : "ClinicStaff",
      submittedByEmail: req.actor.email || "",
      submittedByName: req.actor.fullName || "",
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
    console.error("NexaPay subscription initiate error:", error.message);
    res.status(500).json({ success: false, message: "Could not start payment. Please try again." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinics/subscription-payments/status/:reference
// Lightweight poll target for the checkout UI while it waits on the
// NexaPay webhook — scoped to req.actor.clinicId so one clinic can't
// probe another clinic's payment references.
// ─────────────────────────────────────────────────────────────
router.get("/subscription-payments/status/:reference", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    const SubscriptionPayment = require("../models/SubscriptionPayment");
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
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinics/subscription-payments/my
// Clinic's own submission history — both MANUAL and NEXAPAY rows,
// newest first.
// ─────────────────────────────────────────────────────────────
router.get("/subscription-payments/my", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    const SubscriptionPayment = require("../models/SubscriptionPayment");
    const payments = await SubscriptionPayment.find({ clinic: req.actor.clinicId }).sort({ createdAt: -1 });
    res.json({ success: true, data: payments });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinics/admin/subscription-payments
// NovaBuk platform admin — every submission across all clinics,
// pending ones first, so a reviewer sees what needs action right away.
// ?status=PENDING|VERIFIED|REJECTED to filter.
// ─────────────────────────────────────────────────────────────
router.get("/admin/subscription-payments", protectAdmin, requireAdminRole("admin"), async (req, res) => {
  try {
    const SubscriptionPayment = require("../models/SubscriptionPayment");
    const query = {};
    if (req.query.status) query.status = req.query.status;

    const payments = await SubscriptionPayment.find(query)
      .populate("clinic", "name")
      .sort({ status: 1, createdAt: -1 }); // PENDING < REJECTED < VERIFIED alphabetically — good enough to surface pending first

    res.json({ success: true, data: payments });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/clinics/admin/subscription-payments/:id/review
// NovaBuk platform admin approves or rejects a MANUAL submission.
// Approving calls the same activateClinicPlan() helper the NexaPay
// webhook uses (services/subscriptionService.js), so a clinic ends up
// in an identical state — including correct ANNUAL vs MONTHLY
// crediting — regardless of which path granted the upgrade. Only
// MANUAL rows should ever reach this route; NEXAPAY rows are
// auto-verified by the webhook and never sit here awaiting review.
// Body: { decision: "VERIFIED" | "REJECTED", reviewNote? }
// reviewNote is required when rejecting — it's shown back to the clinic.
// ─────────────────────────────────────────────────────────────
router.patch("/admin/subscription-payments/:id/review", protectAdmin, requireAdminRole("admin"), async (req, res) => {
  try {
    const SubscriptionPayment = require("../models/SubscriptionPayment");
    const { decision, reviewNote } = req.body;

    if (!["VERIFIED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ success: false, message: "decision must be VERIFIED or REJECTED." });
    }
    if (decision === "REJECTED" && (!reviewNote || !reviewNote.trim())) {
      return res.status(400).json({ success: false, message: "A reviewNote is required when rejecting a payment." });
    }

    const payment = await SubscriptionPayment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment submission not found." });
    }
    if (payment.status !== "PENDING") {
      return res.status(400).json({ success: false, message: `This submission was already reviewed (${payment.status}).` });
    }

    payment.status = decision;
    payment.reviewedById = req.admin._id;
    payment.reviewedByName = req.admin.name;
    payment.reviewedAt = new Date();
    payment.reviewNote = reviewNote || "";
    if (decision === "VERIFIED") payment.verifiedVia = "ADMIN_MANUAL";
    await payment.save();

    let clinic = null;
    if (decision === "VERIFIED") {
      clinic = await Clinic.findById(payment.clinic);
      if (clinic) {
        const { activateClinicPlan } = require("../services/subscriptionService");
        await activateClinicPlan({ clinic, plan: payment.plan, billingCycle: payment.billingCycle });
      }
    }

    // Email is best-effort — a delivery failure here should never
    // roll back or fail the review decision that already happened.
    const notifyEmail = payment.submittedByEmail || (clinic || (await Clinic.findById(payment.clinic)))?.contactEmail;
    if (notifyEmail) {
      const {
        sendSubscriptionActivatedEmail,
        sendSubscriptionPaymentRejectedEmail,
      } = require("../services/emailService");
      const clinicName = clinic?.name || "your clinic";

      const emailPromise =
        decision === "VERIFIED"
          ? sendSubscriptionActivatedEmail({
              to: notifyEmail,
              clinicName,
              plan: payment.plan,
              billingCycle: payment.billingCycle,
              amount: payment.amount,
              expiryDate: clinic?.subscriptionExpiry,
              reference: payment.reference,
            })
          : sendSubscriptionPaymentRejectedEmail({
              to: notifyEmail,
              clinicName,
              plan: payment.plan,
              amount: payment.amount,
              reference: payment.reference,
              reason: payment.reviewNote,
            });

      emailPromise.catch((err) =>
        console.error(`[clinics] Subscription ${decision.toLowerCase()} email failed for ${payment.reference}:`, err.message)
      );
    }

    res.json({ success: true, message: `Payment ${decision.toLowerCase()}.`, data: payment });
  } catch (error) {
    console.error("Review subscription payment error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;