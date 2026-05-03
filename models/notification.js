const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: false,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "visit_requested",
        "visit_confirmed",
        "visit_completed",
        "visit_cancelled",
        "walk_in",
        "critical_alert",
        "general",
      ],
      default: "general",
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    // Frontend page to navigate to when clicked
    link: {
      type: String,
      default: "./app-history.html",
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);