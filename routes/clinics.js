const express = require("express");
const router = express.Router();
const Clinic = require("../models/Clinic");
const { protectUser } = require("../middleware/authUser");

// ─────────────────────────────────────────────
// GET /api/clinics
// Public — list all active clinics (Screen 7)
// ─────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { search, service, city, isOpen } = req.query;

    // Build dynamic filter
    const filter = { isActive: true };

    // Search by clinic name or city
    if (search) {
      filter.$or = [
        { name:          { $regex: search, $options: "i" } },
        { "location.city": { $regex: search, $options: "i" } },
        { "location.address": { $regex: search, $options: "i" } },
      ];
    }

    // Filter by service offered
    if (service) {
      filter.services = { $in: [new RegExp(service, "i")] };
    }

    // Filter by city
    if (city) {
      filter["location.city"] = { $regex: city, $options: "i" };
    }

    // Filter by open/closed status
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
// GET /api/clinics/:id
// Public — get a single clinic
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
// POST /api/clinics/seed
// Dev only — seed test clinic data
// Remove or protect this before production!
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
          monday:    { open: "08:00", close: "17:00" },
          tuesday:   { open: "08:00", close: "17:00" },
          wednesday: { open: "08:00", close: "17:00" },
          thursday:  { open: "08:00", close: "17:00" },
          friday:    { open: "08:00", close: "17:00" },
          saturday:  { open: "09:00", close: "14:00" },
          sunday:    { open: null, close: null },
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
          monday:    { open: "07:00", close: "19:00" },
          tuesday:   { open: "07:00", close: "19:00" },
          wednesday: { open: "07:00", close: "19:00" },
          thursday:  { open: "07:00", close: "19:00" },
          friday:    { open: "07:00", close: "19:00" },
          saturday:  { open: "08:00", close: "16:00" },
          sunday:    { open: "10:00", close: "14:00" },
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
          monday:    { open: "08:00", close: "18:00" },
          tuesday:   { open: "08:00", close: "18:00" },
          wednesday: { open: "08:00", close: "18:00" },
          thursday:  { open: "08:00", close: "18:00" },
          friday:    { open: "08:00", close: "18:00" },
          saturday:  { open: null, close: null },
          sunday:    { open: null, close: null },
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

module.exports = router;


// ─────────────────────────────────────────────
// POST /api/clinics/register
// Doctor self-registration — creates a clinic and
// links it back to the doctor's User account.
//
// Why a separate route from POST /api/clinics?
//   POST /api/clinics requires protectAdmin (system admin only).
//   This route requires protectDoctor (any logged-in Doctor).
//   Doctors should be able to register their own clinic
//   without needing an admin to do it for them.
//
// What it does in one request:
//   1. Creates the Clinic document
//   2. Updates the Doctor's User document with clinicId + clinicName
//   3. Returns the updated user so the frontend can update localStorage
//
// Body: { name, address, city, state?, phone, email?, services? }
// ─────────────────────────────────────────────
const { protectDoctor } = require("../middleware/authDoctor");
const User = require("../models/User");

router.post("/register", protectDoctor, async (req, res) => {
  try {
    const {
      name,
      address,
      city,
      state,
      phone,
      email,
      services,
    } = req.body;

    // Validate required fields
    if (!name || !address || !city || !phone) {
      return res.status(400).json({
        success: false,
        message: "Clinic name, address, city and phone are required.",
      });
    }

    // Check if this doctor already has a clinic registered
    if (req.user.clinicId) {
      return res.status(400).json({
        success: false,
        message: "You already have a clinic registered.",
        clinicId: req.user.clinicId,
      });
    }

    // Create the clinic
    const clinic = await Clinic.create({
      name: name.trim(),
      location: {
        address: address.trim(),
        city:    city.trim(),
        state:   state?.trim() || "",
      },
      contactPhone: phone.trim(),
      contactEmail: email?.trim() || "",
      services:     Array.isArray(services) ? services : [],
      isOpen:       true,
      isActive:     true,
    });

    // Link the clinic back to the Doctor's User document
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        clinicId:   clinic._id,
        clinicName: clinic.name,
      },
      { new: true }  // return the updated document
    ).select("-password");

    res.status(201).json({
      success:    true,
      message:    "Clinic registered successfully.",
      clinic:     { id: clinic._id, name: clinic.name },
      // Return full user so frontend can update localStorage
      user: {
        id:              updatedUser._id,
        fullName:        updatedUser.fullName,
        email:           updatedUser.email,
        role:            updatedUser.role,
        avatarUrl:       updatedUser.avatarUrl,
        profileComplete: updatedUser.profileComplete,
        clinicId:        updatedUser.clinicId,
        clinicName:      updatedUser.clinicName,
      },
    });
  } catch (error) {
    console.error("Clinic register error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// ADMIN ROUTES — require admin token
// ─────────────────────────────────────────────
const { protectAdmin } = require("../middleware/auth");

// POST /api/clinics — add new clinic
router.post("/", protectAdmin, async (req, res) => {
  try {
    const clinic = await Clinic.create(req.body);
    res.status(201).json({ success: true, message: "Clinic added.", data: clinic });
  } catch (error) {
    console.error("Add clinic error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// PUT /api/clinics/:id — edit clinic
router.put("/:id", protectAdmin, async (req, res) => {
  try {
    const clinic = await Clinic.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!clinic) return res.status(404).json({ success: false, message: "Clinic not found." });
    res.json({ success: true, message: "Clinic updated.", data: clinic });
  } catch (error) {
    console.error("Update clinic error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// DELETE /api/clinics/:id — toggle active/inactive
router.delete("/:id", protectAdmin, async (req, res) => {
  try {
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) return res.status(404).json({ success: false, message: "Clinic not found." });
    clinic.isActive = !clinic.isActive;
    await clinic.save();
    res.json({ success: true, message: `Clinic ${clinic.isActive ? "activated" : "deactivated"}.`, data: clinic });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// PATCH /api/clinics/:id/toggle — toggle open/closed
router.patch("/:id/toggle", protectAdmin, async (req, res) => {
  try {
    const { isOpen } = req.body;
    const clinic = await Clinic.findByIdAndUpdate(req.params.id, { isOpen }, { new: true });
    if (!clinic) return res.status(404).json({ success: false, message: "Clinic not found." });
    res.json({ success: true, message: `Clinic is now ${isOpen ? "Open" : "Closed"}.`, data: clinic });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});