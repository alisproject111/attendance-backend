const mongoose = require("mongoose")

module.exports = async (req, res) => {
  try {
    console.log("[v0] Starting MongoDB connection test...")

    const mongoUri = process.env.MONGO_URI
    if (!mongoUri) {
      return res.json({ error: "MONGO_URI not found in environment variables" })
    }

    console.log("[v0] MONGO_URI found, attempting connection...")
    console.log("[v0] Connection string format check:", mongoUri.startsWith("mongodb+srv://"))

    // Close existing connection if any
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect()
    }

    // Test connection with detailed error logging
    const connection = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 10000,
    })

    console.log("[v0] Connection successful!")

    // Test database operation
    const admin = connection.connection.db.admin()
    const result = await admin.ping()

    console.log("[v0] Database ping successful:", result)

    res.json({
      success: true,
      connectionState: mongoose.connection.readyState,
      databaseName: mongoose.connection.name,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      ping: result,
    })
  } catch (error) {
    console.error("[v0] MongoDB connection error:", error.message)
    console.error("[v0] Error code:", error.code)
    console.error("[v0] Error name:", error.name)

    res.json({
      success: false,
      error: error.message,
      errorCode: error.code,
      errorName: error.name,
      connectionState: mongoose.connection.readyState,
    })
  }
}
