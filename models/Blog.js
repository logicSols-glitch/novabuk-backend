const mongoose = require("mongoose");

const blogSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, "Please add a title"],
    trim: true,
    maxlength: [200, "Title cannot be more than 200 characters"],
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true,
  },
  content: {
    type: String,
    required: [true, "Please add blog content"],
  },
  excerpt: {
    type: String,
    maxlength: [500, "Excerpt cannot be more than 500 characters"],
  },
  category: {
    type: String,
    enum: ["healthcare", "technology", "innovation", "tips"],
    required: [true, "Please select a category"],
  },
  author: {
    type: String,
    default: "NovaBuk Team",
  },
  authorRole: {
    type: String,
    default: "Content Team",
  },
  image: {
    type: String,
    default: "./images/image 34.png",
  },
  readTime: {
    type: Number,
    default: 5,
  },
  featured: {
    type: Boolean,
    default: false,
  },
  published: {
    type: Boolean,
    default: false,
  },
  publishedAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Create slug from title before saving
blogSchema.pre("save", function (next) {
  if (this.isModified("title")) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Blog", blogSchema);
