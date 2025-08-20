const mongoose = require("mongoose");

const movieSchema = new mongoose.Schema({
  id: Number,
  title: String,
  image: String,
  banner: String,
  rating: Number,
  duration: String,
  genres: [String],
  certificate: String,
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
});

module.exports = mongoose.model("Movie", movieSchema);
