const mongoose = require("mongoose");

const userSessionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "User",
    index: true,
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true,
  },
  lastUsedAt: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("UserSession", userSessionSchema);
