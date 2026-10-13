require("dotenv").config();
const mongoose = require("mongoose");
const Movie = require("../models/movie");

async function removeMovieCertificates({ MovieModel = Movie, dryRun = true } = {}) {
  const filter = { certificate: { $exists: true } };
  const matchedCount = await MovieModel.collection.countDocuments(filter);
  let modifiedCount = 0;

  if (!dryRun && matchedCount > 0) {
    const result = await MovieModel.collection.updateMany(
      filter,
      { $unset: { certificate: "" } }
    );
    modifiedCount = result.modifiedCount;
  }

  return { dryRun, matchedCount, modifiedCount };
}

async function runMigration({ dryRun = true } = {}) {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri || !mongoUri.trim()) {
    throw new Error("Missing required environment variable: MONGO_URI");
  }
  if (!dryRun && process.env.MIGRATION_BACKUP_CONFIRMED !== "true") {
    throw new Error(
      "Set MIGRATION_BACKUP_CONFIRMED=true after creating a database backup"
    );
  }

  await mongoose.connect(mongoUri, { dbName: process.env.MONGO_DB_NAME });
  try {
    const result = await removeMovieCertificates({ dryRun });
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  runMigration({ dryRun: !process.argv.includes("--apply") }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { removeMovieCertificates, runMigration };
