const { planMigration } = require("../scripts/migrate-seat-reservations");

const base = { movie_id: "507f1f77bcf86cd799439011", cinema: "Cinema", screen: "Screen 1", date: new Date("2026-07-11T00:00:00Z"), time: "19:30", status: "confirmed" };

test("preserves tickets and classifies later overlapping bookings", () => {
  const tickets = [
    { ...base, _id: "507f1f77bcf86cd799439021", user: "507f1f77bcf86cd799439031", createdAt: new Date("2026-01-01"), seats: ["A1", "A2"] },
    { ...base, _id: "507f1f77bcf86cd799439022", user: "507f1f77bcf86cd799439032", createdAt: new Date("2026-01-02"), seats: ["A2", "A3"] },
  ];
  const plan = planMigration(tickets);
  expect(plan.ticketUpdates).toEqual(expect.arrayContaining([
    expect.objectContaining({ ticketId: tickets[0]._id, status: "confirmed" }),
    expect.objectContaining({ ticketId: tickets[1]._id, status: "conflicted", conflictingSeats: ["A2"] }),
  ]));
  expect(plan.reservations.map(({ seat }) => seat)).toEqual(["A1", "A2"]);
  expect(plan.malformed).toEqual([]);
});
