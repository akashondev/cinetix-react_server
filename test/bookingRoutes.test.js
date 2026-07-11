const mockAvailability = { show: { showKey: "show" }, bookedSeats: ["A1"], availableCount: 79, totalSeats: 80, soldOut: false };
const mockGetAvailability = jest.fn().mockResolvedValue(mockAvailability);

jest.mock("../services/bookingService", () => ({
  createBookingService: () => ({ getAvailability: mockGetAvailability, createBooking: jest.fn(), cancelBooking: jest.fn() }),
  SeatConflictError: class SeatConflictError extends Error {},
}));

const request = require("supertest");
const app = require("../app");

test("returns public authoritative availability without caching", async () => {
  const response = await request(app).get("/api/shows/availability").query({
    movieId: "507f1f77bcf86cd799439011", cinema: "Cinema", screen: "Screen 1", date: "2026-07-11", time: "19:30",
  });
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body.data).toEqual(mockAvailability);
});
