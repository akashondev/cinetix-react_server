
const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema({
  movie_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  movie_title: {
    type: String,
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "User", // Assuming you have a User model
  },
  seats: {
    type: [String],
    required: true,
  },
  cinema: {
    type: String,
    required: true,
  },
  screen: { type: String, default: "screen 1" },
  showKey: { type: String, index: true },
  time: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  day: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  location: {
    type: String,
    required: true,
  },
  session_id: {
    type: String,
    required: true,
    unique: true,
  },
  requestFingerprint: { type: String },
  status: {
    type: String,
    enum: ["confirmed", "cancelled", "conflicted"],
    default: "confirmed",
  },
  conflictingSeats: { type: [String], default: [] },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Ticket", ticketSchema);

