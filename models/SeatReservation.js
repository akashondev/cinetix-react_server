const mongoose = require("mongoose");

const seatReservationSchema = new mongoose.Schema({
  showKey: { type: String, required: true },
  seat: { type: String, required: true },
  ticketId: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  movieId: { type: mongoose.Schema.Types.ObjectId, required: true },
  cinema: { type: String, required: true },
  screen: { type: String, required: true },
  showDate: { type: String, required: true },
  showTime: { type: String, required: true },
}, { timestamps: true });

seatReservationSchema.index({ showKey: 1, seat: 1 }, { unique: true });

module.exports = mongoose.model("SeatReservation", seatReservationSchema);
