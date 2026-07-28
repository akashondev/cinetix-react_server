const mockAvailability = { show: { showKey: "show" }, bookedSeats: ["A1"], availableCount: 79, totalSeats: 80, soldOut: false };
const mockGetAvailability = jest.fn().mockResolvedValue(mockAvailability);
const mockTicketLean = jest.fn().mockResolvedValue([
  { _id: "ticket-1", movie_title: "Movie", seats: ["A1"] },
]);
const mockTicketSort = jest.fn().mockReturnValue({ lean: mockTicketLean });
const mockTicketFind = jest.fn().mockReturnValue({ sort: mockTicketSort });

jest.mock("../services/bookingService", () => ({
  createBookingService: () => ({ getAvailability: mockGetAvailability, createBooking: jest.fn(), cancelBooking: jest.fn() }),
  SeatConflictError: class SeatConflictError extends Error {},
}));
jest.mock("../models/Ticket_data", () => ({ find: mockTicketFind }));

const request = require("supertest");
const jwt = require("jsonwebtoken");
process.env.JWT_SECRET = "booking-routes-test-secret";
const app = require("../app");

test("returns public authoritative availability without caching", async () => {
  const response = await request(app).get("/api/shows/availability").query({
    movieId: "507f1f77bcf86cd799439011", cinema: "Cinema", screen: "Screen 1", date: "2026-07-11", time: "19:30",
  });
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body.data).toEqual(mockAvailability);
});

test("returns lean tickets newest first without populating movie documents", async () => {
  const token = jwt.sign({ id: "507f1f77bcf86cd799439012" }, process.env.JWT_SECRET);
  const response = await request(app)
    .get("/api/tickets")
    .set("Authorization", `Bearer ${token}`);

  expect(response.status).toBe(200);
  expect(mockTicketFind).toHaveBeenCalledWith({ user: "507f1f77bcf86cd799439012" });
  expect(mockTicketSort).toHaveBeenCalledWith({ createdAt: -1 });
  expect(mockTicketLean).toHaveBeenCalledTimes(1);
  expect(response.body.data).toEqual([
    { _id: "ticket-1", movie_title: "Movie", seats: ["A1"] },
  ]);
});
