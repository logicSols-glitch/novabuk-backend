const express = require("express");
const router = express.Router();
const Clinic = require("../models/Clinic");
const { protectUser } = require("../middleware/authUser");
const { protectDoctor } = require("../middleware/authDoctor.js");
const { protectClinicPortal } = require("../middleware/protectClinicPortal");
const { requireRole } = require("../middleware/requireRole");
const { protectAdmin } = require("../middleware/auth");
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

// POST /api/clinics — add new clinic + doctor account (admin)
router.post("/", protectAdmin, async (req, res) => {
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
router.put("/:id", protectAdmin, async (req, res) => {
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
router.delete("/:id", protectAdmin, async (req, res) => {
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
router.patch("/:id/toggle", protectAdmin, async (req, res) => {
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
router.get("/admin/:id/stats", protectAdmin, async (req, res) => {
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

// ─────────────────────────────────────────────
// POST /api/clinics/upgrade
// Doctor/Clinic Admin — upgrade subscription plan
// ─────────────────────────────────────────────
router.post("/upgrade", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    if (!req.actor.clinicId) {
      return res.status(400).json({
        success: false,
        message: "No clinic linked to your account.",
      });
    }

    const { reference, plan = "Pro", provider = "customProvider" } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference/transaction reference is required.",
      });
    }

    const { isValidPlan, getPlan } = require("../config/plans");
    if (!isValidPlan(plan)) {
      return res.status(400).json({
        success: false,
        message: `"${plan}" is not a valid plan.`,
      });
    }

    // ── VERIFY THE PAYMENT — do not trust the client-supplied reference ──
    // Previously this route activated the plan on ANY reference string
    // with no verification at all. That's a free-upgrade exploit — anyone
    // logged in as a doctor could POST a fake reference and get Pro free.
    const { verifyPayment } = require("../services/paymentProviders");
    const verification = await verifyPayment(provider, reference);

    if (!verification.success) {
      return res.status(402).json({
        success: false,
        message: verification.error || "Payment could not be verified.",
      });
    }

    // Sanity-check the amount paid matches what the plan actually costs.
    // Prevents someone paying for a cheaper plan then sending that
    // reference with plan="Pro" in the request body.
    const planConfig = getPlan(plan);
    if (planConfig?.priceMonthly && verification.amount < planConfig.priceMonthly) {
      return res.status(402).json({
        success: false,
        message: `Amount paid (₦${verification.amount}) does not match the ${planConfig.displayName} plan price (₦${planConfig.priceMonthly}).`,
      });
    }

    // Update the clinic's plan, status, and set expiry to 30 days from now
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    const clinic = await Clinic.findByIdAndUpdate(
      req.actor.clinicId,
      {
        subscriptionPlan: plan,
        subscriptionStatus: "Active",
        subscriptionExpiry: expiryDate,
      },
      { new: true }
    );

    if (!clinic) {
      return res.status(404).json({
        success: false,
        message: "Clinic not found.",
      });
    }

    res.json({
      success: true,
      message: `Clinic upgraded to ${plan} successfully.`,
      clinic,
    });
  } catch (error) {
    console.error("Upgrade error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;