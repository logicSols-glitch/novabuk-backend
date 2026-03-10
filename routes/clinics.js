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
