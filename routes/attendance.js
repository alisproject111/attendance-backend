const express = require("express")
const Attendance = require("../models/Attendance")
const User = require("../models/User")
const Leave = require("../models/Leave")
const jwt = require("jsonwebtoken")
const router = express.Router()

const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1]
    if (!token) return res.status(403).json({ error: "No token provided" })

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = await User.findById(decoded.id)
    if (!req.user || !req.user.isActive) return res.status(403).json({ error: "Invalid token or inactive user" })

    next()
  } catch (error) {
    res.status(403).json({ error: "Invalid token" })
  }
}

const adminAuth = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" })
  }
  next()
}

const managerAuth = (req, res, next) => {
  if (req.user.role !== "admin" && req.user.role !== "manager" && req.user.role !== "hr") {
    return res.status(403).json({ error: "Admin, Manager, or HR access required" })
  }
  next()
}

// Helper function to get current date in YYYY-MM-DD format
const getCurrentDate = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

// Helper function to get current time in HH:MM:SS format
const getCurrentTime = () => {
  const now = new Date()
  const hours = String(now.getHours()).padStart(2, "0")
  const minutes = String(now.getMinutes()).padStart(2, "0")
  const seconds = String(now.getSeconds()).padStart(2, "0")
  return `${hours}:${minutes}:${seconds}`
}

router.post("/checkin", auth, async (req, res) => {
  try {
    const today = getCurrentDate()
    const { location } = req.body

    console.log("Check-in attempt for date:", today)

    // Check if user already has attendance record for today with check-in
    const exists = await Attendance.findOne({ user: req.user._id, date: today })
    if (exists && exists.checkIn) {
      return res.status(400).json({
        message: "You have already checked in today",
        attendance: exists,
      })
    }

    const checkInTime = getCurrentTime()

    let attendance
    if (exists) {
      // Update existing record
      exists.checkIn = checkInTime
      if (location) {
        exists.location = exists.location || {}
        exists.location.checkIn = JSON.stringify(location)
      }
      attendance = await exists.save()
    } else {
      // Create new record
      const locationData = {}
      if (location) {
        locationData.checkIn = JSON.stringify(location)
      }

      attendance = new Attendance({
        user: req.user._id,
        date: today,
        checkIn: checkInTime,
        location: locationData,
      })
      await attendance.save()
    }

    await attendance.populate("user", "name employeeId")

    res.json({
      message: "Checked in successfully",
      attendance,
    })
  } catch (error) {
    console.error("Check-in error:", error)
    res.status(500).json({ error: "Failed to check in. Please try again." })
  }
})

router.post("/checkout", auth, async (req, res) => {
  try {
    const today = getCurrentDate()
    const { location } = req.body

    console.log("Check-out attempt for date:", today)

    const record = await Attendance.findOne({ user: req.user._id, date: today })
    if (!record) {
      return res.status(404).json({ message: "No check-in record found for today. Please check in first." })
    }

    if (!record.checkIn) {
      return res.status(400).json({ message: "You must check in before checking out." })
    }

    if (record.checkOut) {
      return res.status(400).json({
        message: "You have already checked out today",
        attendance: record,
      })
    }

    record.checkOut = getCurrentTime()
    if (location) {
      record.location = record.location || {}
      record.location.checkOut = JSON.stringify(location)
    }

    await record.save()
    await record.populate("user", "name employeeId")

    res.json({
      message: "Checked out successfully",
      attendance: record,
    })
  } catch (error) {
    console.error("Check-out error:", error)
    res.status(500).json({ error: "Failed to check out. Please try again." })
  }
})

router.get("/status", auth, async (req, res) => {
  try {
    const today = getCurrentDate()
    console.log("Getting status for date:", today)

    const attendance = await Attendance.findOne({ user: req.user._id, date: today })

    res.json({
      hasCheckedIn: !!attendance?.checkIn,
      hasCheckedOut: !!attendance?.checkOut,
      attendance,
      currentDate: today,
    })
  } catch (error) {
    console.error("Status error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Get attendance logs with single date filter
router.get("/logs", auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, userId, date } = req.query

    // Get current date if no date specified
    const today = getCurrentDate()
    const targetDate = date || today

    console.log("Fetching logs for date:", targetDate)

    const query = {}

    // Role-based access control
    if (req.user.role === "employee") {
      query.user = req.user._id
    } else if (userId) {
      query.user = userId
    }

    // Always use specific date
    query.date = targetDate

    // Get all active users for admin/manager view
    let allUsers = []
    if (req.user.role !== "employee") {
      const userQuery = { isActive: true }
      if (userId) {
        userQuery._id = userId
      }
      allUsers = await User.find(userQuery).select("_id name employeeId department position")
    }

    // Get attendance records for the specific date
    const attendanceRecords = await Attendance.find(query)
      .populate("user", "name employeeId department position")
      .sort({ createdAt: -1 })

    // Get leave records for the specific date
    const leaveQuery = {
      status: "approved",
      startDate: { $lte: new Date(targetDate) },
      endDate: { $gte: new Date(targetDate) },
    }

    const leaveRecords = await Leave.find(leaveQuery).populate("user", "name employeeId department position")

    // Create comprehensive logs
    let logs = []

    if (req.user.role === "employee") {
      // For employees, just return their attendance records
      logs = attendanceRecords
    } else {
      // For admin/manager, create comprehensive view
      // Create a map of user attendance for the target date
      const attendanceMap = new Map()
      attendanceRecords.forEach((record) => {
        attendanceMap.set(record.user._id.toString(), record)
      })

      // Create a map of users on leave for the target date
      const leaveMap = new Map()
      leaveRecords.forEach((leave) => {
        leaveMap.set(leave.user._id.toString(), leave)
      })

      // Build comprehensive logs for all users
      allUsers.forEach((user) => {
        const userId = user._id.toString()
        const attendance = attendanceMap.get(userId)
        const leave = leaveMap.get(userId)

        if (attendance) {
          logs.push(attendance)
        } else if (leave) {
          // Create a virtual attendance record for leave
          logs.push({
            _id: `leave_${userId}_${targetDate}`,
            user: user,
            date: targetDate,
            checkIn: null,
            checkOut: null,
            workingHours: 0,
            status: "on_leave",
            leaveType: leave.leaveType,
            leaveReason: leave.reason,
            isLeave: true,
          })
        } else {
          // Create a virtual attendance record for absent
          logs.push({
            _id: `absent_${userId}_${targetDate}`,
            user: user,
            date: targetDate,
            checkIn: null,
            checkOut: null,
            workingHours: 0,
            status: "absent",
            isAbsent: true,
          })
        }
      })

      // Sort logs by user name
      logs.sort((a, b) => {
        const nameA = a.user?.name || ""
        const nameB = b.user?.name || ""
        return nameA.localeCompare(nameB)
      })
    }

    // Apply pagination
    const startIndex = (page - 1) * limit
    const endIndex = startIndex + Number.parseInt(limit)
    const paginatedLogs = logs.slice(startIndex, endIndex)

    const total = logs.length

    res.json({
      logs: paginatedLogs,
      totalPages: Math.ceil(total / limit),
      currentPage: Number.parseInt(page),
      total,
      currentDate: targetDate,
    })
  } catch (error) {
    console.error("Attendance logs error:", error)
    res.status(500).json({ error: error.message })
  }
})

// FIXED: Stats calculation with proper date range and working hours
router.get("/stats", auth, async (req, res) => {
  try {
    const { month, year } = req.query
    const currentDate = new Date()
    const targetMonth = month || currentDate.getMonth() + 1
    const targetYear = year || currentDate.getFullYear()

    console.log(`Calculating stats for ${targetYear}-${targetMonth}`)

    // Always get stats for the current user only
    const query = { user: req.user._id }

    // FIXED: Get stats for the specified month with proper date range
    const startDate = `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`
    const lastDay = new Date(targetYear, targetMonth, 0).getDate()
    const endDate = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`

    query.date = { $gte: startDate, $lte: endDate }

    console.log(`Date range: ${startDate} to ${endDate}`)

    const attendanceRecords = await Attendance.find(query)
    console.log(`Found ${attendanceRecords.length} attendance records`)

    // FIXED: Calculate stats properly
    const stats = {
      totalDays: attendanceRecords.length,
      presentDays: attendanceRecords.filter((r) => r.checkIn).length,
      totalHours: 0,
      averageHours: 0,
      lateCount: 0,
    }

    // Calculate total working hours
    attendanceRecords.forEach((record) => {
      if (record.workingHours && record.workingHours > 0) {
        stats.totalHours += record.workingHours
        console.log(`Adding ${record.workingHours}h from ${record.date}`)
      }
    })

    // Round total hours to 2 decimal places
    stats.totalHours = Math.round(stats.totalHours * 100) / 100

    // Calculate average hours per present day
    if (stats.presentDays > 0) {
      stats.averageHours = Math.round((stats.totalHours / stats.presentDays) * 100) / 100
    }

    console.log("Final stats:", stats)

    res.json(stats)
  } catch (error) {
    console.error("Stats calculation error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Generate attendance report
router.get("/report", auth, managerAuth, async (req, res) => {
  try {
    const { startDate, endDate, userId } = req.query

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Start date and end date are required" })
    }

    const query = {
      date: { $gte: startDate, $lte: endDate },
    }

    // Admin/Manager/HR can get reports for all users or a specific user
    if (req.user.role === "admin" || req.user.role === "manager" || req.user.role === "hr") {
      if (userId) {
        query.user = userId
      }
      // If userId is not provided, no user filter is applied, fetching for all
    } else {
      // Employee can only get reports for themselves
      query.user = req.user._id
    }

    const report = await Attendance.find(query)
      .populate("user", "name employeeId department position")
      .sort({ date: -1, "user.name": 1 })

    res.json({
      report,
      dateRange: { startDate, endDate },
      totalRecords: report.length,
    })
  } catch (error) {
    console.error("Report generation error:", error)
    res.status(500).json({ error: error.message })
  }
})

// ENHANCED: Download attendance report with better Excel presentation
router.get("/download-report", auth, managerAuth, async (req, res) => {
  try {
    const { startDate, endDate, userId } = req.query

    console.log("Download report request:", { startDate, endDate, userId })

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Start date and end date are required" })
    }

    const query = {
      date: { $gte: startDate, $lte: endDate },
    }

    // Admin/Manager/HR can get reports for all users or a specific user
    if (req.user.role === "admin" || req.user.role === "manager" || req.user.role === "hr") {
      if (userId) {
        query.user = userId
      }
      // If userId is not provided, no user filter is applied, fetching for all
    } else {
      // Employee can only get reports for themselves
      query.user = req.user._id
    }

    console.log("Query:", query)

    const report = await Attendance.find(query)
      .populate("user", "name employeeId department position")
      .sort({ date: -1, "user.name": 1 })

    console.log(`Found ${report.length} records for report`)

    if (report.length === 0) {
      return res.status(404).json({ error: "No attendance records found for the specified date range" })
    }

    // Helper function to format time for display
    const formatTime = (time) => {
      if (!time) return ""
      try {
        const [hours, minutes] = time.split(":")
        const hour12 =
          Number.parseInt(hours) === 0
            ? 12
            : Number.parseInt(hours) > 12
              ? Number.parseInt(hours) - 12
              : Number.parseInt(hours)
        const ampm = Number.parseInt(hours) >= 12 ? "PM" : "AM"
        return `${hour12}:${minutes} ${ampm}`
      } catch (error) {
        console.error("Error formatting time:", error)
        return time
      }
    }

    // Helper function to format date
    const formatDate = (dateString) => {
      try {
        const date = new Date(dateString + "T00:00:00")
        return date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          weekday: "short",
        })
      } catch (error) {
        console.error("Error formatting date:", error)
        return dateString
      }
    }

    // ENHANCED: Create report header with better presentation
    const reportTitle = "EMPLOYEE ATTENDANCE REPORT"
    const companyName = "Employee Attendance Management System"
    const reportDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })

    // Get employee name for report
    const employeeName = userId ? (report.length > 0 ? report[0].user?.name : "Unknown Employee") : "All Employees"

    // ENHANCED: Report header section with better formatting
    let csvContent = ""

    // Title section
    csvContent += `${reportTitle}\n`
    csvContent += `${companyName}\n`
    csvContent += `Generated on: ${reportDate}\n`
    csvContent += `Report Period: ${formatDate(startDate)} to ${formatDate(endDate)}\n`
    csvContent += `Employee(s): ${employeeName}\n`
    csvContent += `Generated by: ${req.user.name} (${req.user.employeeId})\n`
    csvContent += "\n"

    // ENHANCED: Data table with better headers (removed Notes column)
    const csvHeader =
      [
        "EMPLOYEE NAME",
        "EMPLOYEE ID",
        "DEPARTMENT",
        "POSITION",
        "DATE",
        "DAY OF WEEK",
        "CHECK IN TIME",
        "CHECK OUT TIME",
        "WORKING HOURS",
        "STATUS",
      ].join(",") + "\n"

    csvContent += csvHeader

    // Add separator line
    csvContent += Array(10).fill('""').join(",") + "\n"

    // Data rows
    report.forEach((record) => {
      try {
        const status = record.checkIn && record.checkOut ? "Complete" : record.checkIn ? "Incomplete" : "Absent"
        const workingHours = record.workingHours > 0 ? record.workingHours.toFixed(2) : "0.00"
        const formattedDate = formatDate(record.date)
        const dayOfWeek = new Date(record.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" })

        const row = [
          `"${record.user?.name || ""}"`,
          `"${record.user?.employeeId || ""}"`,
          `"${record.user?.department || ""}"`,
          `"${record.user?.position || ""}"`,
          `"${formattedDate}"`,
          `"${dayOfWeek}"`,
          `"${formatTime(record.checkIn)}"`,
          `"${formatTime(record.checkOut)}"`,
          `"${workingHours}"`,
          `"${status}"`,
        ].join(",")

        csvContent += row + "\n"
      } catch (error) {
        console.error("Error processing record:", error, record)
      }
    })

    // ENHANCED: Summary statistics section with better presentation
    const totalRecords = report.length
    const totalHours = report.reduce((sum, r) => sum + (r.workingHours || 0), 0)
    const completeRecords = report.filter((r) => r.checkIn && r.checkOut).length
    const incompleteRecords = report.filter((r) => r.checkIn && !r.checkOut).length
    const absentRecords = report.filter((r) => !r.checkIn).length
    const avgHours = totalRecords > 0 ? (totalHours / totalRecords).toFixed(2) : "0.00"
    const avgCompleteHours = completeRecords > 0 ? (totalHours / completeRecords).toFixed(2) : "0.00"

    // Add spacing before summary
    csvContent += "\n"

    // Summary section with enhanced formatting
    csvContent += `ATTENDANCE SUMMARY STATISTICS\n`
    csvContent += Array(10).fill('""').join(",") + "\n"

    csvContent += `METRIC,VALUE,PERCENTAGE\n`
    csvContent += `Total Records,${totalRecords},100.00%\n`
    csvContent += `Complete Records,${completeRecords},${((completeRecords / totalRecords) * 100).toFixed(2)}%\n`
    csvContent += `Incomplete Records,${incompleteRecords},${((incompleteRecords / totalRecords) * 100).toFixed(2)}%\n`
    csvContent += `Absent Records,${absentRecords},${((absentRecords / totalRecords) * 100).toFixed(2)}%\n`
    csvContent += "\n"

    csvContent += `WORKING HOURS ANALYSIS\n`
    csvContent += Array(10).fill('""').join(",") + "\n"
    csvContent += `Total Working Hours,${totalHours.toFixed(2)} hours,\n`
    csvContent += `Average Hours per Record,${avgHours} hours,\n`
    csvContent += `Average Hours (Complete Records Only),${avgCompleteHours} hours,\n`
    csvContent += `Maximum Possible Hours,${(totalRecords * 8).toFixed(2)} hours,(Assuming 8 hrs/day)\n`
    csvContent += `Productivity Rate,${((totalHours / (totalRecords * 8)) * 100).toFixed(2)}%,(Actual vs Maximum)\n`
    csvContent += "\n"

    // Additional analysis
    csvContent += `ADDITIONAL INFORMATION\n`
    csvContent += Array(10).fill('""').join(",") + "\n"
    csvContent += `Report Generated By,${req.user.name},${req.user.role}\n`
    csvContent += `Generation Date,${new Date().toLocaleString()},\n`
    csvContent += `System,Employee Attendance Management,v1.0\n`

    console.log("Enhanced CSV generated successfully, length:", csvContent.length)

    // Set proper headers for CSV download
    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader("Content-Disposition", `attachment; filename="Attendance_Report_${startDate}_to_${endDate}.csv"`)
    res.setHeader("Content-Length", Buffer.byteLength(csvContent, "utf8"))

    // Send the CSV data
    res.status(200).send(csvContent)
  } catch (error) {
    console.error("Download report error:", error)
    res.status(500).json({ error: "Failed to generate report: " + error.message })
  }
})

module.exports = router
