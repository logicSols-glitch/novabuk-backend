const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { sendEmail } = require("../services/emailService");

// Simple Contact schema — stores enquiries in MongoDB
const contactSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, lowercase: true, trim: true },
  organisation: { type: String, default: "" },
  message:      { type: String, required: true },
  read:         { type: Boolean, default: false },
}, { timestamps: true });

const Contact = mongoose.model("Contact", contactSchema);

// ─────────────────────────────────────────────
// POST /api/contact
// Public — submit contact form (contact.html)
// ─────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { name, email, organisation, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: "Name, email and message are required.",
      });
    }

    // Save to MongoDB
    await Contact.create({ name, email, organisation, message });

    // Forward to NovaBuk team email (non-blocking)
    sendEmail({
      to: process.env.CONTACT_EMAIL || "hello@novabuk.com",
      subject: `New enquiry from ${name} — NovaBuk Contact Form`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#7ecad7,#35bac9);padding:24px;border-radius:12px 12px 0 0;">
            <h2 style="margin:0;color:white;">New Contact Form Submission</h2>
          </div>
          <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px;border:1px solid #eee;">
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Organisation:</strong> ${organisation || "—"}</p>
            <p><strong>Message:</strong></p>
            <p style="background:white;padding:16px;border-radius:8px;border:1px solid #eee;">${message}</p>
          </div>
        </div>
      `,
    }).catch((err) => console.error("Contact email failed:", err.message));

    // Send auto-reply to sender
    sendEmail({
      to: email,
      subject: "We received your message — NovaBuk",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#7ecad7,#35bac9);padding:24px;border-radius:12px 12px 0 0;">
            <h2 style="margin:0;color:white;">NovaBuk</h2>
          </div>
          <div style="padding:24px;">
            <p>Hi ${name},</p>
            <p>Thank you for reaching out to NovaBuk. We have received your message and will get back to you within 2 business days.</p>
            <p style="color:#888;font-size:13px;">This is an automated confirmation. Please do not reply to this email.</p>
          </div>
        </div>
      `,
    }).catch((err) => console.error("Auto-reply failed:", err.message));

    res.status(201).json({
      success: true,
      message: "Your message has been sent. We will get back to you soon.",
    });
  } catch (error) {
    console.error("Contact form error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
