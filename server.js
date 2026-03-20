const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();

// ── CORS ──────────────────────────────────────────────────
const allowedOrigins = [
  "https://novabuk.vercel.app",
  "https://novabukrepo.vercel.app",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:5501",   
  "http://127.0.0.1:5501",     
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allows file:// and null
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// ── MIDDLEWARE ────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── DATABASE ──────────────────────────────────────────────
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✓ MongoDB Connected Successfully");
  } catch (error) {
    console.error("✗ MongoDB Connection Error:", error);
    process.exit(1);
  }
};

connectDB();

// ── ROUTES — existing ────────────────────────────────────
app.use("/api/blogs",   require("./routes/blogs"));
app.use("/api/admin",   require("./routes/admin"));
app.use("/api/uploads", require("./routes/uploads"));

// ── ROUTES — new patient app ─────────────────────────────
app.use("/api/users",    require("./routes/users"));    // auth + profile
app.use("/api/symptoms", require("./routes/symptoms")); // symptom logging
app.use("/api/clinics",  require("./routes/clinics"));  // clinic directory
app.use("/api/visits",    require("./routes/visits"));    // visit requests + history
app.use("/api/dashboard", require("./routes/dashboard")); // home screen stats
app.use("/api/reviews",   require("./routes/reviews"));   // clinic reviews
app.use("/api/contact",   require("./routes/contact"));   // contact form

// ── HEALTH CHECK ──────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status: "Server is running",
    timestamp: new Date(),
    environment: process.env.NODE_ENV || "development",
  });
});

// ── 404 ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ── ERROR HANDLER ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Server error",
    error:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
  });
});

// ── START ─────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 NovaBuk Backend running on http://localhost:${PORT}`);
  console.log(`   ENV: ${process.env.NODE_ENV || "development"}`);
});
