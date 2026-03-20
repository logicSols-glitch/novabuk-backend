const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },

    // ── HEALTH PROFILE (Screen 4) ─────────────────────────
    healthProfile: {
      ageRange: {
        type: String,
        default: null,
      },
      gender: {
        type: String,
        default: null,
      },
      existingConditions: { type: [String], default: [] },
      allergies:           { type: [String], default: [] },
    },

    // ── EXTENDED PROFILE (Profile Settings screen) ────────
    phone:       { type: String, default: "" },
    dateOfBirth: { type: String, default: "" },
    address:     { type: String, default: "" },
    city:        { type: String, default: "" },
    state:       { type: String, default: "" },
    avatarUrl:   { type: String, default: "" },
    emergencyContact: {
      name:  { type: String, default: "" },
      phone: { type: String, default: "" },
    },

    // ── PRIVACY SETTINGS (Figma — Privacy Settings screen) ──
    privacySettings: {
      shareDataWithProviders:  { type: Boolean, default: true  },
      marketingCommunications: { type: Boolean, default: false },
      dataAnalytics:           { type: Boolean, default: true  },
      thirdPartyDataSharing:   { type: Boolean, default: false },
      profileVisibility: {
        type: String,
        enum: ["Private - Only me", "Healthcare providers only", "Private - Anyone"],
        default: "Private - Only me",
      },
    },

    // ── NOTIFICATION SETTINGS (Figma — Notification Settings screen) ──
    notificationSettings: {
      appointmentReminders: { type: Boolean, default: true  },
      healthTips:           { type: Boolean, default: true  },
      clinicUpdates:        { type: Boolean, default: true  },
      visitStatusUpdates:   { type: Boolean, default: true  },
      smsNotifications:     { type: Boolean, default: false },
      emailNotifications:   { type: Boolean, default: true  },
    },

    // ── ONBOARDING ────────────────────────────────────────
    profileComplete: { type: Boolean, default: false },
    isActive:        { type: Boolean, default: true  },

    // ── PASSWORD RESET ────────────────────────────────────
    passwordResetToken:   { type: String, default: null },
    passwordResetExpires: { type: Date,   default: null },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);