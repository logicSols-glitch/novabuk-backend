const express = require('express');
const router = express.Router();
const { getCloudinarySignature } = require('../controllers/uploadController');
const { protect } = require('../middleware/auth');

// Returns Cloudinary signing info or upload_preset for client uploads
router.post('/cloudinary/sign', protect, getCloudinarySignature);

module.exports = router;
