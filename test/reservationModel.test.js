const SeatReservation = require("../models/SeatReservation");
const Ticket = require("../models/Ticket_data");

test("enforces one reservation per show and seat", () => {
  const index = SeatReservation.schema.indexes().find(([keys]) => keys.showKey === 1 && keys.seat === 1);
  expect(index).toBeDefined();
  expect(index[1].unique).toBe(true);
});

test("tickets default to confirmed and restrict lifecycle status", () => {
  const status = Ticket.schema.path("status");
  expect(status.defaultValue).toBe("confirmed");
  expect(status.enumValues).toEqual(["confirmed", "cancelled", "conflicted"]);
});
