const mongoose = require("mongoose");

const tmdbImportBlockSchema = new mongoose.Schema({
  tmdbId: { type: Number, required: true, unique: true },
  deletedAt: { type: Date, default: Date.now, required: true },
});

module.exports = mongoose.model("TmdbImportBlock", tmdbImportBlockSchema);
