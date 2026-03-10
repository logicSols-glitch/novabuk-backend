const mongoose = require("mongoose");

const clinicSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Clinic name is required"],
      trim: true,
    },
    location: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, default: "" },
      coordinates: {
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
      },
    },
    contactPhone: { type: String, default: "" },
    contactEmail: { type: String, default: "" },
    // Operating hours
    openingHours: {
      monday:    { open: String, close: String },
      tuesday:   { open: String, close: String },
      wednesday: { open: String, close: String },
      thursday:  { open: String, close: String },
      friday:    { open: String, close: String },
      saturday:  { open: String, close: String },
      sunday:    { open: String, close: String },
    },
    // Dynamic open/closed status (can be toggled by admin)
    isOpen: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Services offered
    services: {
      type: [String],
      default: [],
    },
    image: {
      type: String,
      default: "",
    },
    // Auto-calculated from reviews
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    numReviews:    { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Clinic", clinicSchema);
