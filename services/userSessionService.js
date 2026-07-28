const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const UserSession = require("../models/UserSession");

const ACCESS_TOKEN_LIFETIME = "15m";

function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signAccessToken(user) {
  return jwt.sign(
    { id: user._id || user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_LIFETIME }
  );
}

async function createSession(user) {
  const refreshToken = crypto.randomBytes(32).toString("hex");
  await UserSession.create({
    user: user._id || user.id,
    tokenHash: hashRefreshToken(refreshToken),
  });

  return {
    token: signAccessToken(user),
    refreshToken,
  };
}

async function refreshSession(refreshToken) {
  if (!refreshToken || typeof refreshToken !== "string") return null;

  const session = await UserSession.findOneAndUpdate(
    { tokenHash: hashRefreshToken(refreshToken) },
    { $set: { lastUsedAt: new Date() } },
    { new: true }
  );
  if (!session) return null;

  return {
    token: signAccessToken({ id: session.user }),
  };
}

async function revokeSession(refreshToken) {
  if (!refreshToken || typeof refreshToken !== "string") return;
  await UserSession.deleteOne({
    tokenHash: hashRefreshToken(refreshToken),
  });
}

module.exports = {
  createSession,
  hashRefreshToken,
  refreshSession,
  revokeSession,
  signAccessToken,
};
