const mongoose = require("mongoose");
require("dotenv").config();
const Visit = require("./models/Visit");
const Clinic = require("./models/Clinic");
const User = require("./models/User");

async function checkDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to DB");
    
    const visits = await Visit.find().populate("clinic", "name").populate("user", "fullName").sort({ createdAt: -1 }).limit(5);
    console.log("LAST 5 VISITS:");
    visits.forEach(v => {
      console.log(`- ID: ${v._id}`);
      console.log(`  Patient: ${v.user ? v.user.fullName : "Unknown"}`);
      console.log(`  Clinic: ${v.clinic ? v.clinic.name : "Unknown"} (ID: ${v.clinic ? v.clinic._id : "None"})`);
      console.log(`  Status: ${v.status}`);
      console.log(`  Preferred Date: ${v.preferredDate}`);
      console.log(`  Created At: ${v.createdAt}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error("DB Error:", err);
    process.exit(1);
  }
}

checkDB();
