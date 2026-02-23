const express = require("express");
const router = express.Router();
const cloudinary = require("cloudinary").v2;
// const crypto = require("crypto");

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// POST /api/uploads/cloudinary/sign
// Returns signature, timestamp, AND api_key for signed uploads
router.post("/cloudinary/sign", (req, res) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);

    // You can add extra params here if needed (e.g. folder, transformation)
    const paramsToSign = {
      timestamp,
      // folder: "novabuk-blogs", // optional: organise uploads in Cloudinary
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET
    );

    res.json({
      success: true,
      unsigned: false,
      api_key: process.env.CLOUDINARY_API_KEY, // ← was missing before!
      signature,
      timestamp,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    });
  } catch (error) {
    console.error("Cloudinary sign error:", error);
    res.status(500).json({ success: false, message: "Failed to generate signature" });
  }
});

module.exports = router;
