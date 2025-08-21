const app = require("../server.js")

// Serverless function handler for Vercel
module.exports = (req, res) => {
  console.log("[v0] Serverless function invoked:", req.method, req.url)
  console.log("[v0] Environment check:", {
    mongoUri: !!process.env.MONGO_URI,
    jwtSecret: !!process.env.JWT_SECRET,
    nodeEnv: process.env.NODE_ENV,
  })

  try {
    // Handle the request with Express app
    app(req, res)
  } catch (error) {
    console.error("[v0] Serverless function error:", error)
    res.status(500).json({
      error: "Serverless function failed",
      details: error.message,
    })
  }
}
