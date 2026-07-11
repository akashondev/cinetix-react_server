const mongoose = require("mongoose");

const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const VALID_SEATS = new Set(ROWS.flatMap((row) => Array.from({ length: 12 }, (_, index) => index + 1)
  .filter((number) => number !== 4 && number !== 9)
  .map((number) => `${row}${number}`)));

class ValidationError extends Error {
  constructor(message, code = "VALIDATION_ERROR") {
    super(message);
    this.name = "ValidationError";
    this.code = code;
  }
}

function normalizeTime(value) {
  const input = String(value || "").trim().toUpperCase();
  const match = input.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/);
  if (!match) throw new ValidationError("Invalid showtime");
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) throw new ValidationError("Invalid showtime");
  if (match[3] === "AM" && hour === 12) hour = 0;
  if (match[3] === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeDate(value) {
  const input = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new ValidationError("Invalid show date");
  const [year, month, day] = input.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new ValidationError("Invalid show date");
  }
  return input;
}

function normalizeText(value, field) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) throw new ValidationError(`${field} is required`);
  return normalized;
}

function normalizeShowIdentity(input = {}) {
  const movieId = String(input.movieId || input.movie_id || "").trim();
  if (!mongoose.Types.ObjectId.isValid(movieId)) throw new ValidationError("Invalid movie ID");
  const show = {
    movieId,
    cinema: normalizeText(input.cinema, "Cinema"),
    screen: normalizeText(input.screen || "Screen 1", "Screen"),
    date: normalizeDate(input.date),
    time: normalizeTime(input.time),
  };
  show.showKey = [show.movieId, show.cinema, show.screen, show.date, show.time].map(encodeURIComponent).join("|");
  return show;
}

function normalizeSeatIds(seats) {
  if (!Array.isArray(seats) || seats.length === 0 || seats.length > 10) throw new ValidationError("Select between 1 and 10 seats");
  const normalized = seats.map((seat) => String(seat).trim().toUpperCase());
  if (new Set(normalized).size !== normalized.length) throw new ValidationError("Duplicate seat selected");
  normalized.forEach((seat) => {
    if (!VALID_SEATS.has(seat)) throw new ValidationError(`Invalid seat: ${seat}`);
  });
  return normalized.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

module.exports = { normalizeShowIdentity, normalizeSeatIds, ValidationError, VALID_SEATS };
