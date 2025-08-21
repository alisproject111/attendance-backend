const app = require("../server.js")

module.exports = (req, res) => {
  console.log("[v0] Serverless function invoked:", req.method, req.url)
  console.log("[v0] Original URL:", req.originalUrl)
  console.log("[v0] Path:", req.path)
  console.log("[v0] Environment check:", {
    mongoUri: !!process.env.MONGO_URI,
    jwtSecret: !!process.env.JWT_SECRET,
    nodeEnv: process.env.NODE_ENV,
  })

  try {
    // Ensure proper URL handling for root requests
    if (req.url === "/" || req.url === "" || req.originalUrl === "/") {
      console.log("[v0] Root route detected, handling directly")
    }

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
