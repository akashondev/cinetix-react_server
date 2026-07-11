require("dotenv").config();
const mongoose = require("mongoose");
const Ticket = require("../models/Ticket_data");
const SeatReservation = require("../models/SeatReservation");
const { normalizeShowIdentity, normalizeSeatIds } = require("../services/showIdentity");

function calendarDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function planMigration(tickets) {
  const claims = new Set();
  const ticketUpdates = [];
  const reservations = [];
  const malformed = [];
  const sorted = [...tickets].sort((left, right) => {
    const time = new Date(left.createdAt || 0) - new Date(right.createdAt || 0);
    return time || String(left._id).localeCompare(String(right._id));
  });

  for (const ticket of sorted) {
    try {
      if (ticket.status === "cancelled") continue;
      const show = normalizeShowIdentity({
        movieId: ticket.movie_id, cinema: ticket.cinema, screen: ticket.screen || "Screen 1",
        date: calendarDate(ticket.date), time: ticket.time,
      });
      const seats = normalizeSeatIds(ticket.seats);
      const conflictingSeats = seats.filter((seat) => claims.has(`${show.showKey}|${seat}`));
      if (conflictingSeats.length) {
        ticketUpdates.push({ ticketId: ticket._id, status: "conflicted", conflictingSeats, showKey: show.showKey, screen: show.screen });
        continue;
      }
      ticketUpdates.push({ ticketId: ticket._id, status: "confirmed", conflictingSeats: [], showKey: show.showKey, screen: show.screen });
      seats.forEach((seat) => {
        claims.add(`${show.showKey}|${seat}`);
        reservations.push({ showKey: show.showKey, seat, ticketId: ticket._id, userId: ticket.user, movieId: show.movieId, cinema: show.cinema, screen: show.screen, showDate: show.date, showTime: show.time });
      });
    } catch (error) {
      malformed.push({ ticketId: ticket._id, reason: error.message });
    }
  }
  return { ticketUpdates, reservations, malformed };
}

async function runMigration({ dryRun = true } = {}) {
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME });
  const tickets = await Ticket.find().lean();
  const plan = planMigration(tickets);
  if (!dryRun) {
    if (process.env.MIGRATION_BACKUP_CONFIRMED !== "true") throw new Error("Set MIGRATION_BACKUP_CONFIRMED=true after creating a database backup");
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (plan.ticketUpdates.length) await Ticket.bulkWrite(plan.ticketUpdates.map(({ ticketId, ...fields }) => ({ updateOne: { filter: { _id: ticketId }, update: { $set: fields } } })), { session });
        await SeatReservation.deleteMany({}, { session });
        if (plan.reservations.length) await SeatReservation.insertMany(plan.reservations, { session, ordered: true });
      });
      await SeatReservation.syncIndexes();
    } finally { await session.endSession(); }
  }
  console.log(JSON.stringify({ dryRun, confirmed: plan.reservations.length, conflicted: plan.ticketUpdates.filter((item) => item.status === "conflicted").length, malformed: plan.malformed.length }, null, 2));
  await mongoose.disconnect();
  return plan;
}

if (require.main === module) {
  runMigration({ dryRun: !process.argv.includes("--apply") }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { planMigration, runMigration };
