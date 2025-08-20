require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("./models/UserModel");
const Movie = require("./models/movie");
const Ticket = require("./models/Ticket_data");
// const ticketRoutes = require("./routes/Ticket");
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
// app.use("/api/tickets", ticketRoutes);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME,
    serverSelectionTimeoutMS: 43200000,
    socketTimeoutMS: 43200000,
  })
  .then(async () => {
    console.log("MongoDB connected");

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

    // Start server
    app.listen(3000, () => {
      console.log("Server running on http://localhost:3000");
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });

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
  res.send("CineTix API is running!");
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

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      userId: user._id,
      name: user.name,
      email: user.email,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error during login" });
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

// Movie Routes
app.get("/api/movies", async (req, res) => {
  try {
    const movies = await Movie.find();
    res.json(movies);
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
    const movie = new Movie(req.body);
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
      req.body,
      { new: true }
    );
    res.json(updatedMovie);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete("/api/movies/:id", async (req, res) => {
  try {
    await Movie.findByIdAndDelete(req.params.id);
    res.json({ message: "Movie deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Ticket Routes (Integrated directly)
app.post("/api/tickets", authenticateToken, async (req, res) => {
  try {
    const {
      movie_id,
      movie_title,
      seats,
      cinema,
      time,
      date,
      day,
      price,
      location,
      session_id,
    } = req.body;

    // Validate required fields
    if (
      !movie_id ||
      !movie_title ||
      !seats ||
      !cinema ||
      !time ||
      !date ||
      !day ||
      !price ||
      !location
    ) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Validate movie_id format
    if (!mongoose.Types.ObjectId.isValid(movie_id)) {
      return res.status(400).json({ message: "Invalid movie ID format" });
    }

    const newTicket = new Ticket({
      movie_id,
      movie_title: movie_title || movie_name,
      user: req.user.id,
      seats,
      cinema,
      time,
      date: new Date(date),
      day,
      price,
      location,
      session_id: session_id || `TKT-${Date.now()}`,
    });

    const savedTicket = await newTicket.save();

    res.status(201).json({
      success: true,
      data: savedTicket,
      message: "Ticket created successfully",
    });
  } catch (error) {
    console.error("Error creating ticket:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create ticket",
      error: error.message,
    });
  }
});


app.get("/api/tickets", authenticateToken, async (req, res) => {
  try {
    console.log("running");
    const ticket = await Ticket.find({
      user: req.user.id,
    }).populate("movie_id");

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

app.delete("/api/tickets/:id", authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid ticket ID format" });
    }

    const ticket = await Ticket.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found or unauthorized",
      });
    }

    res.json({
      success: true,
      message: "Ticket cancelled successfully",
    });
  } catch (error) {
    console.error("Error cancelling ticket:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel ticket",
    });
  }
});

module.exports = app;
