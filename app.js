if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("./models/UserModel");
const Movie = require("./models/movie");
const Ticket = require("./models/Ticket_data");
const { Server } = require("socket.io");
const { createBookingService, SeatConflictError } = require("./services/bookingService");
const { ValidationError } = require("./services/showIdentity");
const {
  createSession,
  refreshSession,
  revokeSession,
} = require("./services/userSessionService");
const {
  isShowExpired,
  ticketVisibilityFilter,
} = require("./services/ticketLifecycle");
const {
  DAY_MS,
  dateKey,
  getIndianMarketDate,
  isDuplicateMovie,
  synchronizeTmdbMovies,
} = require("./services/tmdbSyncService");

// const ticketRoutes = require("./routes/Ticket");
const app = express();
const bookingService = createBookingService();
let io;
const PORT = process.env.PORT || 3000;
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "https://cinetix-react.vercel.app",
  process.env.FRONTEND_URL,
].filter(Boolean);
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

async function syncTmdbCatalog(options = {}) {
  try {
    const result = await synchronizeTmdbMovies(options);
    if (!result.skipped) console.log("TMDB movie synchronization complete", result);
    return result;
  } catch (error) {
    console.error("TMDB movie synchronization failed; existing data preserved:", error.message);
    return { skipped: false, failed: true, error: error.message };
  }
}

function manualMoviePayload(body, { isCreate = false } = {}) {
  const payload = { ...body };
  if (isCreate || "posterUrl" in body || "banner" in body) {
    payload.posterUrl = body.posterUrl || body.banner || "";
  }
  if (
    isCreate ||
    "heroImageUrl" in body ||
    "image" in body
  ) {
    payload.heroImageUrl =
      body.heroImageUrl ||
      body.image ||
      (isCreate ? body.posterUrl || body.banner : "") ||
      "";
  }
  delete payload.image;
  delete payload.banner;
  delete payload.tmdbId;
  delete payload.originGroup;
  delete payload.nowShowingSince;
  delete payload.source;
  delete payload.isActive;
  if (isCreate) payload.source = "manual";
  return payload;
}

function isStaleComingSoonMovie(movie) {
  if (movie?.category !== "comingSoon" || !movie.releaseDate) return false;
  const releaseDate = new Date(movie.releaseDate);
  return !Number.isNaN(releaseDate.getTime()) && releaseDate <= new Date();
}

function capPublicTmdbNowShowing(movies) {
  let tmdbNowShowingCount = 0;
  return movies.filter((movie) => {
    if (movie.source !== "tmdb" || movie.category !== "nowShowing") return true;
    if (tmdbNowShowingCount >= 15) return false;
    tmdbNowShowingCount += 1;
    return true;
  });
}

function applyDisplayOrder(movies) {
  const ordered = [...movies];
  const pinned = ordered
    .map((movie, index) => ({ movie, index }))
    .filter(({ movie }) => Number.isInteger(Number(movie.displayOrder)) && Number(movie.displayOrder) > 0)
    .sort(
      (left, right) =>
        Number(left.movie.displayOrder) - Number(right.movie.displayOrder) ||
        left.index - right.index
    );

  for (const { movie } of pinned) {
    const currentIndex = ordered.findIndex(
      (candidate) => String(candidate._id) === String(movie._id)
    );
    if (currentIndex === -1) continue;
    const [item] = ordered.splice(currentIndex, 1);
    ordered.splice(Math.min(Number(item.displayOrder) - 1, ordered.length), 0, item);
  }

  return ordered;
}

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(bodyParser.json());
// app.use("/api/tickets", ticketRoutes);

async function startServer() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri || typeof mongoUri !== "string" || !mongoUri.trim()) {
    throw new Error("Missing required environment variable: MONGO_URI");
  }

  await mongoose.connect(mongoUri, {
    dbName: process.env.MONGO_DB_NAME,
    serverSelectionTimeoutMS: 43200000,
    socketTimeoutMS: 43200000,
  });
    console.log("MongoDB connected");

    await syncTmdbCatalog();

    // Create test user if not exists
    const existingUser = await User.findOne({ email: "test@example.com" });
    if (!existingUser) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash("password123", salt);

      const newUser = new User({
        name: "Test User",
        email: "test@example.com",
        password: hashedPassword,
      });

      await newUser.save();
      console.log("Test user inserted.");
    }

    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`[Error] Port ${PORT} is already in use by another process.`);
        console.error(`Please stop the other process or set a different PORT in .env.`);
      } else {
        console.error("Server error:", error);
      }
      process.exit(1);
    });
    process.once("SIGUSR2", () => {
      server.close(() => {
        process.kill(process.pid, "SIGUSR2");
      });
    });

    const tmdbSyncInterval = setInterval(syncTmdbCatalog, DAY_MS);
    tmdbSyncInterval.unref?.();
    server.on("close", () => clearInterval(tmdbSyncInterval));
    io = new Server(server, { cors: corsOptions });
    io.on("connection", (socket) => {
      socket.on("show:join", (showKey) => typeof showKey === "string" && socket.join(showKey));
      socket.on("show:leave", (showKey) => typeof showKey === "string" && socket.leave(showKey));
    });
}

function emitAvailability(availability) {
  if (io) io.to(availability.show.showKey).emit("show:availability", availability);
}

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  // console.log(token);

  if (!token) return res.status(401).json({ message: "Access token missing" });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = { id: decoded.id };
    next();
  });
}

// Routes
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/movies/:id", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ error: "Movie not found" });
    }
    res.json(movie);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch movie" });
  }
});

// User Routes
app.post("/api/users/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({ name, email, password: hashedPassword });
    await newUser.save();

    res.status(201).json({
      message: "User registered successfully",
      userId: newUser._id,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Server error during registration" });
  }
});

app.post("/api/users/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const { token, refreshToken } = await createSession(user);

    res.status(200).json({
      message: "Login successful",
      token,
      refreshToken,
      userId: user._id,
      name: user.name,
      email: user.email,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error during login" });
  }
});

app.post("/api/users/session/refresh", async (req, res) => {
  try {
    const refreshed = await refreshSession(req.body.refreshToken);
    if (!refreshed) {
      return res.status(401).json({ message: "Invalid refresh session" });
    }
    res.json(refreshed);
  } catch (error) {
    console.error("Session refresh error:", error);
    res.status(500).json({ message: "Unable to refresh session" });
  }
});

app.post("/api/users/session/logout", async (req, res) => {
  try {
    await revokeSession(req.body.refreshToken);
    res.status(204).end();
  } catch (error) {
    console.error("Session logout error:", error);
    res.status(500).json({ message: "Unable to end session" });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Server error fetching users" });
  }
});

app.get("/api/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    console.error("User fetch error:", error);
    res.status(500).json({ message: "Server error fetching user" });
  }
});

// Movie Routes (Managed)
let lastSyncTimestamp = 0;
let isSyncInProgress = false;

async function checkAndSyncCatalog(force = false) {
  if (isSyncInProgress) return;
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const timeSinceLastSync = Date.now() - lastSyncTimestamp;

  const nowCount = await Movie.countDocuments({ category: "nowShowing", isActive: true });
  const comingCount = await Movie.countDocuments({ category: "comingSoon", isActive: true });

  const needsSync = force || nowCount < 15 || comingCount < 10 || timeSinceLastSync > TWELVE_HOURS;
  if (!needsSync) return;

  isSyncInProgress = true;
  try {
    const result = await syncTmdbCatalog();
    lastSyncTimestamp = Date.now();
    return result;
  } finally {
    isSyncInProgress = false;
  }
}

function safeDateKey(value = new Date()) {
  if (typeof dateKey === "function") return dateKey(value);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function deduplicateMovieList(movies) {
  if (!Array.isArray(movies)) return [];
  if (typeof isDuplicateMovie !== "function") return movies;
  const result = [];
  for (const movie of movies) {
    const isDupe = result.some((existing) => isDuplicateMovie(movie, existing));
    if (!isDupe) {
      result.push(movie);
    }
  }
  return result;
}

app.get("/api/movies", async (req, res) => {
  try {
    const today = safeDateKey(new Date());

    const filter =
      req.query.includeInactive === "true"
        ? {}
        : { $or: [{ source: { $ne: "tmdb" } }, { isActive: true }] };
    const movies = await Movie.find(filter);

    if (!Array.isArray(movies)) {
      return res.json([]);
    }

    const tmdbDue = movies.filter(
      (m) =>
        m &&
        m.source === "tmdb" &&
        m.category === "comingSoon" &&
        m.releaseDate &&
        String(m.releaseDate).slice(0, 10) <= today
    );
    if (tmdbDue.length > 0 && typeof Movie.updateMany === "function") {
      Movie.updateMany(
        { _id: { $in: tmdbDue.map((m) => m._id) } },
        { $set: { category: "nowShowing", nowShowingSince: new Date() } }
      ).catch((err) => console.error("Promotion update error:", err.message));
    }

    if (typeof Movie.countDocuments === "function") {
      const activeComingSoon = movies.filter(
        (m) => m.category === "comingSoon" && m.releaseDate > today
      );
      if (activeComingSoon.length < 10 || movies.length === 0) {
        checkAndSyncCatalog().catch((err) =>
          console.error("Auto catalog sync error:", err.message)
        );
      }
    }

    const visibleMovies =
      req.query.includeInactive === "true"
        ? movies
        : movies
            .filter((movie) => {
              if (movie.source !== "tmdb" && isStaleComingSoonMovie(movie)) {
                return false;
              }
              return true;
            })
            .map((movie) => {
              const obj = movie.toObject ? movie.toObject() : { ...movie };
              if (
                obj.category === "comingSoon" &&
                obj.source === "tmdb" &&
                obj.releaseDate &&
                String(obj.releaseDate).slice(0, 10) <= today
              ) {
                obj.category = "nowShowing";
              }
              return obj;
            });

    const dedupedMovies = deduplicateMovieList(visibleMovies);

    res.json(
      req.query.includeInactive === "true"
        ? dedupedMovies
        : capPublicTmdbNowShowing(applyDisplayOrder(dedupedMovies))
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/movies/:id", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ error: "Movie not found" });
    }
    res.json(movie);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch movie" });
  }
});

app.post("/api/movies", async (req, res) => {
  try {
    const movie = new Movie(manualMoviePayload(req.body, { isCreate: true }));
    const newMovie = await movie.save();
    res.status(201).json(newMovie);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put("/api/movies/:id", async (req, res) => {
  try {
    const updatedMovie = await Movie.findByIdAndUpdate(
      req.params.id,
      manualMoviePayload(req.body),
      { new: true }
    );
    res.json(updatedMovie);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete("/api/movies/:id", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).json({ message: "Movie not found" });
    await Movie.deleteOne({ _id: movie._id });
    const sync = await syncTmdbCatalog({
      excludeTmdbIds: movie.tmdbId ? [movie.tmdbId] : [],
    });
    res.json({ message: "Movie deleted", sync });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/shows/availability", async (req, res) => {
  try {
    const availability = await bookingService.getAvailability(req.query);
    res.set("Cache-Control", "no-store").json({ success: true, data: availability });
  } catch (error) {
    res.status(error instanceof ValidationError ? 400 : 503).json({ success: false, code: error.code || "AVAILABILITY_FAILED", message: error.message });
  }
});

app.post("/api/tickets", authenticateToken, async (req, res) => {
  try {
    const result = await bookingService.createBooking({ userId: req.user.id, payload: req.body });
    emitAvailability(result.availability);
    res.status(result.idempotent ? 200 : 201).json({ success: true, data: result.ticket, availability: result.availability });
  } catch (error) {
    if (error instanceof SeatConflictError) return res.status(409).json({ success: false, code: error.code, message: error.message, conflictingSeats: error.conflictingSeats, availability: error.availability });
    if (error instanceof ValidationError) return res.status(400).json({ success: false, code: error.code, message: error.message });
    console.error("Booking transaction failed:", error);
    res.status(503).json({ success: false, code: "BOOKING_TRANSACTION_FAILED", message: "Booking could not be completed. No seats were reserved." });
  }
});


app.get("/api/tickets", authenticateToken, async (req, res) => {
  try {
    const ticket = await Ticket.find(ticketVisibilityFilter(req.user.id))
      .sort({ createdAt: -1 })
      .lean();

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found or unauthorized",
      });
    }

    res.json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    console.error("Error fetching ticket:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ticket",
    });
  }
});

app.delete("/api/tickets/:id/history", authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID",
      });
    }

    const ticket = await Ticket.findOne({
      _id: req.params.id,
      user: req.user.id,
    });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found or unauthorized",
      });
    }
    if (!isShowExpired(ticket)) {
      return res.status(409).json({
        success: false,
        message: "Ticket can only be removed after the showtime",
      });
    }

    const hiddenTicket = await Ticket.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { $set: { hiddenByUserAt: new Date() } },
      { new: true }
    );
    res.json({
      success: true,
      data: hiddenTicket,
      message: "Expired ticket removed",
    });
  } catch (error) {
    console.error("Error removing expired ticket:", error);
    res.status(500).json({
      success: false,
      message: "Failed to remove expired ticket",
    });
  }
});

app.delete("/api/tickets/:id", authenticateToken, async (req, res) => {
  try {
    const result = await bookingService.cancelBooking({ userId: req.user.id, ticketId: req.params.id });
    emitAvailability(result.availability);
    res.json({ success: true, data: result.ticket, availability: result.availability, message: "Ticket cancelled successfully" });
  } catch (error) {
    const status = error instanceof ValidationError ? (error.code === "NOT_FOUND" ? 404 : 400) : 503;
    res.status(status).json({ success: false, code: error.code || "CANCELLATION_FAILED", message: error.message });
  }
});

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Server startup failed:", error);
    process.exitCode = 1;
  });
}

module.exports = app;
module.exports.startServer = startServer;
