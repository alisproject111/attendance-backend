const express = require("express")
const cors = require("cors")
const mongoose = require("mongoose")
require("dotenv").config()

const authRoutes = require("./routes/auth")
const attendanceRoutes = require("./routes/attendance")
const userRoutes = require("./routes/users")
const leaveRoutes = require("./routes/leave")

const app = express()

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }),
)
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))

// Root route handler
app.get("/", (req, res) => {
  console.log("[v0] Root route handler called")
  res.json({
    message: "Attendance Management API",
    version: "1.0.0",
    status: "Running",
    endpoints: {
      health: "/api/health",
      auth: {
        login: "POST /api/auth/login",
        register: "POST /api/auth/register",
        logout: "POST /api/auth/logout",
      },
      users: {
        profile: "GET /api/users/profile",
        update: "PUT /api/users/profile",
      },
      attendance: {
        checkin: "POST /api/attendance/checkin",
        checkout: "POST /api/attendance/checkout",
        records: "GET /api/attendance/records",
      },
      leave: {
        apply: "POST /api/leave/apply",
        requests: "GET /api/leave/requests",
      },
    },
    documentation: "Visit /api/health for system status",
  })
})

// Database connection
console.log("Connecting to MongoDB...")
console.log("MongoDB URI:", process.env.MONGO_URI ? "Set" : "Not set")
console.log("JWT Secret:", process.env.JWT_SECRET ? "Set" : "Not set")

let cachedConnection = null

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI environment variable is not set")
    }

    if (cachedConnection && mongoose.connection.readyState === 1) {
      console.log("✅ Using cached MongoDB connection")
      return true
    }

    if (mongoose.connection.readyState === 0) {
      console.log("Establishing new MongoDB connection...")
      console.log("Connection string format:", process.env.MONGO_URI.substring(0, 20) + "...")

      const connection = await mongoose.connect(process.env.MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000, // Reduced timeout for faster failure
        socketTimeoutMS: 45000,
        maxPoolSize: 1, // Reduced pool size for serverless
        minPoolSize: 0,
        maxIdleTimeMS: 30000,
        bufferCommands: false,
        bufferMaxEntries: 0,
      })

      cachedConnection = connection
      console.log("✅ MongoDB connected successfully")
      console.log("Database name:", mongoose.connection.name)
      console.log("Connection host:", mongoose.connection.host)
    } else if (mongoose.connection.readyState === 1) {
      console.log("✅ MongoDB already connected")
      cachedConnection = mongoose.connection
    } else {
      console.log("MongoDB connection state:", mongoose.connection.readyState)
    }
    return true
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message)
    console.error("Error name:", err.name)
    console.error("Error code:", err.code)
    if (err.reason) {
      console.error("Error reason:", err.reason)
    }
    cachedConnection = null
    // Don't exit in serverless environment
    if (process.env.VERCEL !== "1") {
      process.exit(1)
    }
    return false
  }
}

connectDB()
  .then(() => {
    console.log("Initial connection attempt completed")
  })
  .catch((err) => {
    console.error("Initial connection failed:", err.message)
  })

// Routes
app.use("/api/auth", authRoutes)
app.use("/api/attendance", attendanceRoutes)
app.use("/api/users", userRoutes)
app.use("/api/leave", leaveRoutes)

// Health check
app.get("/api/health", async (req, res) => {
  let connectionAttempted = false

  console.log("Health check - attempting database connection...")
  connectionAttempted = true
  const connectionSuccess = await connectDB()

  const connectionStates = {
    0: "Disconnected",
    1: "Connected",
    2: "Connecting",
    3: "Disconnecting",
  }

  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    database: connectionStates[mongoose.connection.readyState] || "Unknown",
    connectionState: mongoose.connection.readyState,
    connectionAttempted,
    connectionSuccess,
    environment: {
      mongoUri: !!process.env.MONGO_URI,
      jwtSecret: !!process.env.JWT_SECRET,
      frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
    },
  })
})

// Add this before the 404 handler
app.get("/api/auth/login", (req, res) => {
  res.json({
    message: "Login endpoint - use POST method with email and password",
    method: "POST",
    endpoint: "/api/auth/login",
    body: {
      email: "your-email@example.com",
      password: "your-password",
    },
  })
})

// 404 handler
app.use("*", (req, res) => {
  console.log("404 - Route not found:", req.originalUrl)
  res.status(404).json({ error: "Route not found" })
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Global error handler:", err.stack)
  console.error("Error details:", {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  })
  res.status(500).json({
    error: "Something went wrong!",
    ...(process.env.NODE_ENV !== "production" && { details: err.message }),
  })
})

module.exports = app

if (require.main === module) {
  const PORT = process.env.PORT || 5000
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`)
    console.log(`🌐 Health check: http://localhost:${PORT}/api/health`)
    console.log(`🔐 Auth endpoint: http://localhost:${PORT}/api/auth/login`)
  })
}
