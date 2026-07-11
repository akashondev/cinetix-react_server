const crypto = require("crypto");
const mongoose = require("mongoose");
const Ticket = require("../models/Ticket_data");
const SeatReservation = require("../models/SeatReservation");
const { normalizeShowIdentity, normalizeSeatIds, ValidationError, VALID_SEATS } = require("./showIdentity");

class SeatConflictError extends Error {
  constructor(conflictingSeats, availability) {
    super("One or more selected seats are no longer available");
    this.name = "SeatConflictError";
    this.code = "SEAT_CONFLICT";
    this.conflictingSeats = conflictingSeats;
    this.availability = availability;
  }
}

function fingerprint(userId, show, seats, sessionId) {
  return crypto.createHash("sha256").update(JSON.stringify({ userId: String(userId), showKey: show.showKey, seats, sessionId })).digest("hex");
}

function createBookingService({ TicketModel = Ticket, ReservationModel = SeatReservation, startSession = () => mongoose.startSession() } = {}) {
  async function getAvailability(identity) {
    const show = normalizeShowIdentity(identity);
    const reservations = await ReservationModel.find({ showKey: show.showKey }).lean();
    const bookedSeats = [...new Set(reservations.map(({ seat }) => seat))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return {
      show,
      bookedSeats,
      totalSeats: VALID_SEATS.size,
      availableCount: VALID_SEATS.size - bookedSeats.length,
      soldOut: bookedSeats.length >= VALID_SEATS.size,
      updatedAt: new Date().toISOString(),
    };
  }

  async function createBooking({ userId, payload }) {
    const show = normalizeShowIdentity(payload);
    const seats = normalizeSeatIds(payload.seats);
    if (!payload.session_id || !payload.movie_title || !payload.location || !payload.day || !Number.isFinite(Number(payload.price))) {
      throw new ValidationError("Missing required booking fields");
    }
    const requestFingerprint = fingerprint(userId, show, seats, payload.session_id);
    const existingQuery = TicketModel.findOne({ session_id: payload.session_id });
    const existing = existingQuery && typeof existingQuery.lean === "function" ? await existingQuery.lean() : await existingQuery;
    if (existing) {
      if (String(existing.user) === String(userId) && existing.requestFingerprint === requestFingerprint) {
        return { ticket: existing, availability: await getAvailability(show), idempotent: true };
      }
      throw new ValidationError("Booking session ID has already been used", "IDEMPOTENCY_CONFLICT");
    }

    const session = await startSession();
    let ticket;
    try {
      await session.withTransaction(async () => {
        const created = await TicketModel.create([{
          movie_id: show.movieId,
          movie_title: payload.movie_title,
          user: userId,
          seats,
          cinema: show.cinema,
          screen: show.screen,
          showKey: show.showKey,
          time: show.time,
          date: new Date(`${show.date}T00:00:00.000Z`),
          day: payload.day,
          price: Number(payload.price),
          location: payload.location,
          session_id: payload.session_id,
          requestFingerprint,
          status: "confirmed",
        }], { session });
        ticket = created[0];
        await ReservationModel.insertMany(seats.map((seat) => ({
          showKey: show.showKey, seat, ticketId: ticket._id, userId,
          movieId: show.movieId, cinema: show.cinema, screen: show.screen,
          showDate: show.date, showTime: show.time,
        })), { session, ordered: true });
      });
    } catch (error) {
      if (error && error.code === 11000) {
        const availability = await getAvailability(show);
        throw new SeatConflictError(seats.filter((seat) => availability.bookedSeats.includes(seat)), availability);
      }
      throw error;
    } finally {
      await session.endSession();
    }
    return { ticket, availability: await getAvailability(show), idempotent: false };
  }

  async function cancelBooking({ userId, ticketId }) {
    if (!mongoose.Types.ObjectId.isValid(ticketId)) throw new ValidationError("Invalid ticket ID");
    const session = await startSession();
    let ticket;
    try {
      await session.withTransaction(async () => {
        ticket = await TicketModel.findOneAndUpdate(
          { _id: ticketId, user: userId, status: "confirmed" },
          { $set: { status: "cancelled" } },
          { new: true, session }
        );
        if (!ticket) throw new ValidationError("Ticket not found or already cancelled", "NOT_FOUND");
        await ReservationModel.deleteMany({ ticketId: ticket._id }, { session });
      });
    } finally {
      await session.endSession();
    }
    return { ticket, availability: await getAvailability({
      movieId: ticket.movie_id, cinema: ticket.cinema, screen: ticket.screen,
      date: ticket.showKey.split("|")[3], time: ticket.time,
    }) };
  }

  return { getAvailability, createBooking, cancelBooking };
}

module.exports = { createBookingService, SeatConflictError };
