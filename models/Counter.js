const mongoose = require("mongoose");

/**
 * Counter — generic atomic sequence generator.
 *
 * WHY THIS EXISTS: generating a receipt number by counting existing
 * documents (`PatientBill.countDocuments(...) + 1`) has a race
 * condition — if two receptionists at different clinics mark a bill
 * paid in the same instant, both requests could read the same count
 * before either writes, producing a DUPLICATE receipt number. That's
 * a real bug in production with concurrent traffic, not a theoretical
 * one.
 *
 * findOneAndUpdate with $inc is atomic at the database level — two
 * simultaneous requests will always get two different sequential
 * values, guaranteed by MongoDB itself, not by application logic.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. "receipt-202606"
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model("Counter", counterSchema);

async function getNextSequence(counterName) {
  const result = await Counter.findOneAndUpdate(
    { _id: counterName },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return result.seq;
}

module.exports = { Counter, getNextSequence };