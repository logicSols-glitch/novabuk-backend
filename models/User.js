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
    age:         { type: Number, default: null },
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

    // ── ROLE ─────────────────────────────────────────────
    role: {
      type: String,
      enum: ["Patient", "Doctors"],
      default: "Patient",
    },

    // ── ONBOARDING & VERIFICATION ─────────────────────────
    profileComplete: { type: Boolean, default: false },
    isActive:        { type: Boolean, default: true  },
    isVerified:      { type: Boolean, default: false },
    otpCode:         { type: String,  default: null },
    otpExpires:      { type: Date,    default: null },
    googleId:        { type: String,  unique: true, sparse: true },
    clinicId:        { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", default: null, index: true },

    // ── PASSWORD RESET ────────────────────────────────────
    passwordResetToken:   { type: String, default: null },
    passwordResetExpires: { type: Date,   default: null },

    // ── GLOBAL IDENTIFIER ─────────────────────────────────
    novaBukId: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  { timestamps: true }
);

// Generate NovaBuk ID before saving
userSchema.pre("save", async function (next) {
  if (this.role === "Patient" && !this.novaBukId) {
    const random = Math.floor(1000 + Math.random() * 9000);
    this.novaBukId = `NB-${random}`;
  }
  next();
});

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