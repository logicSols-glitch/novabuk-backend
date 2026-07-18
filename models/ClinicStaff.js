const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

/**
 * ClinicStaff — doctors, nurses, receptionists, pharmacists, lab techs
 * who use the clinic portal.
 *
 * Completely separate from the User model (patients + the clinic OWNER,
 * who is a User with role: "Doctors" — see clinics.js /register route).
 * ClinicStaff records are only ever created BY that owner (or by a system
 * admin) via /clinic-auth/my-staff or /clinic-auth/register-staff — there
 * is no self-registration for clinic staff.
 *
 * Each staff member belongs to exactly ONE clinic.
 *
 * NOTE ON "admin" role: this is a DELEGATED admin the clinic owner can
 * promote a staff member to (distinct from the owner's own implicit
 * ownership via clinicId on their User doc). Delegated "admin" staff
 * bypass the general requireRole() checks the same way the owner does
 * (e.g. staff management, billing) — but NOT the stricter
 * requireClinicalRole() checks (writing consultation notes, etc.),
 * which only the owner (a doctor by construction) and actual
 * doctor/nurse roles pass. See middleware/requireRole.js.
 */
const clinicStaffSchema = new mongoose.Schema(
  {
    // Which clinic this person works at
    clinic: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Clinic",
      required: [true, "Clinic is required"],
      index:    true,
    },

    fullName: {
      type:     String,
      required: [true, "Full name is required"],
      trim:     true,
    },

    email: {
      type:      String,
      required:  [true, "Email is required"],
      unique:    true,
      lowercase: true,
      trim:      true,
    },

    password: {
      type:      String,
      required:  [true, "Password is required"],
      minlength: 6,
      select:    false, // never returned by default — must explicitly .select("+password")
    },

    // What they can do in the clinic portal.
    // pharmacist/lab_tech are Pro-tier-only roles — see checkSeatLimit,
    // which rejects creating these roles on a Growth-plan clinic.
    role: {
      type:    String,
      enum:    ["doctor", "nurse", "receptionist", "pharmacist", "lab_tech", "admin"],
      default: "doctor",
    },

    isActive: {
      type:    Boolean,
      default: true,
    },
    passwordResetToken:   { type: String, default: null },
    passwordResetExpires: { type: Date,   default: null },

    // Set on every successful login (see clinic-auth.js /login route).
    // Powers the optional "Last active" column in the staff table —
    // real data (when they last actually logged in), not a fake live
    // "online now" indicator, which would need session/heartbeat
    // infrastructure that doesn't exist.
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Hash password before saving
// This runs automatically before .save() if password was modified
clinicStaffSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Method to compare plain password against stored hash
clinicStaffSchema.methods.comparePassword = async function (candidate) {
  return await bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model("ClinicStaff", clinicStaffSchema);