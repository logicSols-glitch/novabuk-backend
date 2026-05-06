const mongoose = require("mongoose");

const tipSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: [true, "Tip text is required"],
      trim: true,
    },
    category: {
      type: String,
      enum: ["general", "nutrition", "exercise", "mental-health", "hygiene"],
      default: "general",
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Tip", tipSchema);
