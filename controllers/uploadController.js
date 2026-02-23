const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Returns signing data for client to perform signed upload, or upload_preset for unsigned
exports.getCloudinarySignature = (req, res) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);

    // If an unsigned upload preset is configured, return it so client can do unsigned uploads
    if (process.env.CLOUDINARY_UPLOAD_PRESET) {
      return res.status(200).json({
        success: true,
        unsigned: true,
        upload_preset: process.env.CLOUDINARY_UPLOAD_PRESET,
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      });
    }

    // Otherwise return a signed payload
    const paramsToSign = { timestamp };
    const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);

    res.status(200).json({
      success: true,
      unsigned: false,
      signature,
      timestamp,
      api_key: process.env.CLOUDINARY_API_KEY,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
