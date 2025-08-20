// // routes/ticket.js
// const express = require("express");
// const mongoose = require("mongoose");
// const Ticket = require("../models/Ticket_data");
// const router = express.Router();

// function authenticateToken(req, res, next) {
//   const authHeader = req.headers["authorization"];
//   const token = authHeader && authHeader.split(" ")[1];
//   console.log(token);

//   if (!token) return res.status(401).json({ message: "Access token missing" });

//   jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
//     if (err) return res.status(403).json({ message: "Invalid token" });
//     req.user = { id: decoded.id };
//     next();
//   });
// }


// // Create a new ticket
// router.post("/api/tickets", authenticateToken, async (req, res) => {
//   try {
//     const {
//       movie_id,
//       seats,
//       cinema,
//       time,
//       date,
//       day,
//       price,
//       location,
//       session_id,
//     } = req.body;

//     // Validate required fields
//     if (
//       !movie_id ||
//       !seats ||
//       !cinema ||
//       !time ||
//       !date ||
//       !day ||
//       !price ||
//       !location
//     ) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }

//     // Validate movie_id format
//     if (!mongoose.Types.ObjectId.isValid(movie_id)) {
//       return res.status(400).json({ message: "Invalid movie ID format" });
//     }

//     const newTicket = new Ticket({
//       movie_id,
//       user: req.user.id,
//       seats,
//       cinema,
//       time,
//       date: new Date(date),
//       day,
//       price,
//       location,
//       session_id: session_id || `TKT-${Date.now()}`,
//     });

//     const savedTicket = await newTicket.save();

//     res.status(201).json({
//       success: true,
//       data: savedTicket,
//       message: "Ticket created successfully",
//     });
//   } catch (error) {
//     console.error("Error creating ticket:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to create ticket",
//       error: error.message,
//     });
//   }
// });

// // Get all tickets of the logged-in user
// router.get("/api/tickets/my-tickets", authenticateToken, async (req, res) => {
//   try {
//     const tickets = await Ticket.find({ user: req.user.id })
//       .populate("movie_id")
//       .sort({ createdAt: -1 });

//     res.json({
//       success: true,
//       count: tickets.length,
//       data: tickets,
//     });
//   } catch (error) {
//     console.error("Error fetching tickets:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch tickets",
//     });
//   }
// });

// // Get a specific ticket by ID
// router.get("/api/tickets/:id", authenticateToken, async (req, res) => {
//   try {
//     if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
//       return res.status(400).json({ message: "Invalid ticket ID format" });
//     }

//     const ticket = await Ticket.findOne({
//       _id: req.params.id,
//       user: req.user.id,
//     }).populate("movie_id");

//     if (!ticket) {
//       return res.status(404).json({
//         success: false,
//         message: "Ticket not found or unauthorized",
//       });
//     }

//     res.json({
//       success: true,
//       data: ticket,
//     });
//   } catch (error) {
//     console.error("Error fetching ticket:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch ticket",
//     });
//   }
// });

// // Delete a ticket
// router.delete("/api/tickets/:id", authenticateToken, async (req, res) => {
//   try {
//     if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
//       return res.status(400).json({ message: "Invalid ticket ID format" });
//     }

//     const ticket = await Ticket.findOneAndDelete({
//       _id: req.params.id,
//       user: req.user.id,
//     });

//     if (!ticket) {
//       return res.status(404).json({
//         success: false,
//         message: "Ticket not found or unauthorized",
//       });
//     }

//     res.json({
//       success: true,
//       message: "Ticket cancelled successfully",
//     });
//   } catch (error) {
//     console.error("Error cancelling ticket:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to cancel ticket",
//     });
//   }
// });

// module.exports = router;
