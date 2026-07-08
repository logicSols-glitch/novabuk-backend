#!/usr/bin/env node

/**
 * Database Cleanup Script: Fix Corrupt Email Addresses
 * Usage: NODE_ENV=development node scripts/fix-emails.js
 *
 * This script finds and fixes email addresses with multiple @ symbols
 */

const mongoose = require("mongoose");
require("dotenv").config();

const User = require("../models/User");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✓ MongoDB connected");
  } catch (error) {
    console.error("✗ MongoDB connection error:", error.message);
    process.exit(1);
  }
};

const fixCorruptEmails = async () => {
  try {
    // Find all users with invalid email format (multiple @ symbols or no @)
    const allUsers = await User.find({});
    let fixed = 0;
    let removed = 0;

    for (const user of allUsers) {
      const atCount = (user.email.match(/@/g) || []).length;

      if (atCount !== 1) {
        console.log(`\n⚠️  Found corrupt email: ${user.email}`);
        console.log(`   User: ${user.fullName} (ID: ${user._id})`);
        console.log(`   @ symbols: ${atCount}`);

        // Try to extract the first valid email part
        const emails = user.email.split("@");
        if (emails.length > 1) {
          // Take first part + last part (remove middle duplicates)
          const corrected = `${emails[0]}@${emails[emails.length - 1]}`;
          console.log(`   → Attempting fix to: ${corrected}`);

          try {
            user.email = corrected.toLowerCase().trim();
            await user.save();
            fixed++;
            console.log(`   ✓ Fixed successfully`);
          } catch (err) {
            console.log(`   ✗ Fix failed: ${err.message}`);
            // If validation still fails, remove the user
            try {
              await User.deleteOne({ _id: user._id });
              removed++;
              console.log(`   ✓ Removed corrupt user record`);
            } catch (deleteErr) {
              console.log(`   ✗ Could not remove: ${deleteErr.message}`);
            }
          }
        }
      }
    }

    console.log(`\n${"=".repeat(50)}`);
    console.log(`Summary:`);
    console.log(`  Fixed: ${fixed}`);
    console.log(`  Removed: ${removed}`);
    console.log(`  Total checked: ${allUsers.length}`);
    console.log(`${"=".repeat(50)}\n`);
  } catch (error) {
    console.error("Error during cleanup:", error);
    process.exit(1);
  } finally {
    mongoose.disconnect();
  }
};

connectDB().then(() => fixCorruptEmails());
