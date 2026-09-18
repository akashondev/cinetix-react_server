const mongoose = require("mongoose");

const movieSchema = new mongoose.Schema({
  id: Number,
  tmdbId: { type: Number, unique: true, sparse: true },
  source: {
    type: String,
    enum: ["tmdb", "manual"],
    default: "manual",
    required: true,
  },
  title: String,
  posterUrl: String,
  heroImageUrl: String,
  image: String,
  banner: String,
  rating: Number,
  popularity: Number,
  displayOrder: Number,
  duration: String,
  genres: [String],
  releaseDate: String,
  director: String,
  cast: [String],
  description: String,
  trailerUrl: String,
  category: {
    type: String,
    enum: ["nowShowing", "comingSoon"],
    required: true,
  },
  originGroup: {
    type: String,
    enum: ["indian", "international"],
  },
  nowShowingSince: Date,
  isActive: { type: Boolean, default: true },
});

module.exports = mongoose.model("Movie", movieSchema);
