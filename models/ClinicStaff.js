const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

/**
 * ClinicStaff — doctors, nurses, receptionists who use the clinic portal.
 *
 * Completely separate from the User model (patients).
 * A ClinicStaff account must be created by a system admin —
 * there is no self-registration for clinic staff.
 *
 * Each staff member belongs to exactly ONE clinic.
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

    // What they can do in the clinic portal
    role: {
      type:    String,
      enum:    ["doctor", "nurse", "receptionist", "admin"],
      default: "doctor",
    },

    isActive: {
      type:    Boolean,
      default: true,
    },
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