jest.mock("../models/Ticket_data", () => ({ findOne: jest.fn() }));
jest.mock("../models/SeatReservation", () => ({ find: jest.fn() }));

const Ticket = require("../models/Ticket_data");
const SeatReservation = require("../models/SeatReservation");
const { createBookingService, SeatConflictError } = require("../services/bookingService");

const identity = {
  movie_id: "507f1f77bcf86cd799439011", cinema: "CinePlex", screen: "Screen 1",
  date: "2026-07-11", time: "7:30 PM",
};

test("availability is show scoped and detects sold out", async () => {
  SeatReservation.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ seat: "A1" }, { seat: "A2" }]) });
  const service = createBookingService({ TicketModel: Ticket, ReservationModel: SeatReservation });
  const result = await service.getAvailability(identity);
  expect(SeatReservation.find).toHaveBeenCalledWith({ showKey: result.show.showKey });
  expect(result.bookedSeats).toEqual(["A1", "A2"]);
  expect(result.availableCount).toBe(78);
  expect(result.soldOut).toBe(false);
});

test("maps a duplicate reservation to a seat conflict", async () => {
  const duplicate = Object.assign(new Error("duplicate"), { code: 11000 });
  const session = { withTransaction: jest.fn().mockRejectedValue(duplicate), endSession: jest.fn() };
  const ReservationModel = {
    find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ seat: "A1" }]) }),
  };
  const service = createBookingService({
    TicketModel: { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) },
    ReservationModel,
    startSession: jest.fn().mockResolvedValue(session),
  });
  await expect(service.createBooking({ userId: "507f1f77bcf86cd799439012", payload: { ...identity, seats: ["A1"], session_id: "one", movie_title: "Movie", price: 180, location: "Here", day: "Saturday" } }))
    .rejects.toBeInstanceOf(SeatConflictError);
  expect(session.endSession).toHaveBeenCalled();
});
