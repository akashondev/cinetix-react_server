const mockAvailability = { show: { showKey: "show" }, bookedSeats: ["A1"], availableCount: 79, totalSeats: 80, soldOut: false };
const mockGetAvailability = jest.fn().mockResolvedValue(mockAvailability);
const mockTicketLean = jest.fn().mockResolvedValue([
  { _id: "ticket-1", movie_title: "Movie", seats: ["A1"] },
]);
const mockTicketSort = jest.fn().mockReturnValue({ lean: mockTicketLean });
const mockTicketFind = jest.fn().mockReturnValue({ sort: mockTicketSort });
const mockTicketFindOne = jest.fn();
const mockTicketFindOneAndUpdate = jest.fn();

jest.mock("../services/bookingService", () => ({
  createBookingService: () => ({ getAvailability: mockGetAvailability, createBooking: jest.fn(), cancelBooking: jest.fn() }),
  SeatConflictError: class SeatConflictError extends Error {},
}));
jest.mock("../models/Ticket_data", () => ({
  find: mockTicketFind,
  findOne: mockTicketFindOne,
  findOneAndUpdate: mockTicketFindOneAndUpdate,
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
process.env.JWT_SECRET = "booking-routes-test-secret";
const app = require("../app");

beforeEach(() => {
  jest.clearAllMocks();
});

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
  expect(mockTicketFind).toHaveBeenCalledWith({
    user: "507f1f77bcf86cd799439012",
    hiddenByUserAt: null,
    $or: [
      { date: { $gt: expect.any(Date) } },
      { date: { $exists: false } },
    ],
  });
  expect(mockTicketSort).toHaveBeenCalledWith({ createdAt: -1 });
  expect(mockTicketLean).toHaveBeenCalledTimes(1);
  expect(response.body.data).toEqual([
    { _id: "ticket-1", movie_title: "Movie", seats: ["A1"] },
  ]);
});

test("allows an owner to hide a ticket after its show has passed", async () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-07-28T12:00:00.000Z"));
  const userId = "507f1f77bcf86cd799439012";
  const ticketId = "507f1f77bcf86cd799439013";
  const ticket = {
    _id: ticketId,
    user: userId,
    date: new Date("2026-07-27T00:00:00.000Z"),
    time: "19:30",
  };
  mockTicketFindOne.mockResolvedValue(ticket);
  mockTicketFindOneAndUpdate.mockResolvedValue({
    ...ticket,
    hiddenByUserAt: new Date(),
  });
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET);

  const response = await request(app)
    .delete(`/api/tickets/${ticketId}/history`)
    .set("Authorization", `Bearer ${token}`);

  expect(response.status).toBe(200);
  expect(mockTicketFindOneAndUpdate).toHaveBeenCalledWith(
    { _id: ticketId, user: userId },
    { $set: { hiddenByUserAt: expect.any(Date) } },
    { new: true }
  );
  jest.useRealTimers();
});

test("does not hide a ticket before its showtime", async () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-07-28T12:00:00.000Z"));
  const userId = "507f1f77bcf86cd799439012";
  const ticketId = "507f1f77bcf86cd799439014";
  mockTicketFindOne.mockResolvedValue({
    _id: ticketId,
    user: userId,
    date: new Date("2026-07-28T00:00:00.000Z"),
    time: "19:30",
  });
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET);

  const response = await request(app)
    .delete(`/api/tickets/${ticketId}/history`)
    .set("Authorization", `Bearer ${token}`);

  expect(response.status).toBe(409);
  expect(mockTicketFindOneAndUpdate).not.toHaveBeenCalled();
  jest.useRealTimers();
});
