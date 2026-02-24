// const express = require('express');
// const router = express.Router();
// const { getCloudinarySignature } = require('../controllers/uploadController');
// const { protect } = require('../middleware/auth');

// // Returns Cloudinary signing info or upload_preset for client uploads
// router.post('/cloudinary/sign', protect, getCloudinarySignature);

// module.exports = router;

const express = require("express");
const router = express.Router();
const cloudinary = require("cloudinary").v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// POST /api/uploads/cloudinary/sign
router.post("/cloudinary/sign", (req, res) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);

    const paramsToSign = { timestamp };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET
    );

    res.json({
      success: true,
      api_key: process.env.CLOUDINARY_API_KEY,
      signature,
      timestamp,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      // Do NOT include unsigned:false — omitting it keeps the signed flow clean
    });
  } catch (error) {
    console.error("Cloudinary sign error:", error);
    res.status(500).json({ success: false, message: "Failed to generate signature" });
  }
});

module.exports = router;