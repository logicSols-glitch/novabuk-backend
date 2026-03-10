const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
    },
    // Must have visited before reviewing
    visit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Visit",
      required: true,
    },
    // Star rating 1-5
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: [500, "Review cannot exceed 500 characters"],
      default: "",
    },
  },
  { timestamps: true }
);

// One review per user per visit
reviewSchema.index({ user: 1, visit: 1 }, { unique: true });

// Auto-update clinic average rating after save/delete
reviewSchema.statics.calcAverageRating = async function (clinicId) {
  const stats = await this.aggregate([
    { $match: { clinic: clinicId } },
    { $group: { _id: "$clinic", avgRating: { $avg: "$rating" }, numReviews: { $sum: 1 } } },
  ]);

  if (stats.length > 0) {
    await mongoose.model("Clinic").findByIdAndUpdate(clinicId, {
      averageRating: Math.round(stats[0].avgRating * 10) / 10,
      numReviews: stats[0].numReviews,
    });
  } else {
    await mongoose.model("Clinic").findByIdAndUpdate(clinicId, {
      averageRating: 0,
      numReviews: 0,
    });
  }
};

reviewSchema.post("save", function () {
  this.constructor.calcAverageRating(this.clinic);
});

reviewSchema.post("findOneAndDelete", function (doc) {
  if (doc) doc.constructor.calcAverageRating(doc.clinic);
});

module.exports = mongoose.model("Review", reviewSchema);
