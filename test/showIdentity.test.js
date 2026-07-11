const { normalizeShowIdentity, normalizeSeatIds, ValidationError } = require("../services/showIdentity");

const base = {
  movieId: "507f1f77bcf86cd799439011",
  cinema: " CinePlex ",
  screen: "Screen 1",
  date: "2026-07-11",
  time: "7:30 PM",
};

test("normalizes equivalent show identity values", () => {
  const twelveHour = normalizeShowIdentity(base);
  const twentyFourHour = normalizeShowIdentity({ ...base, time: "19:30" });
  expect(twelveHour).toEqual(twentyFourHour);
  expect(twelveHour).toMatchObject({ cinema: "cineplex", screen: "screen 1", date: "2026-07-11", time: "19:30" });
});

test.each(["movieId", "cinema", "screen", "date", "time"])("includes %s in show identity", (field) => {
  const changed = { movieId: "507f191e810c19729de860ea", cinema: "Other", screen: "Screen 2", date: "2026-07-12", time: "8:30 PM" };
  expect(normalizeShowIdentity({ ...base, [field]: changed[field] }).showKey).not.toBe(normalizeShowIdentity(base).showKey);
});

test("normalizes and validates seat ids", () => {
  expect(normalizeSeatIds(["a2", "A1"])).toEqual(["A1", "A2"]);
  expect(() => normalizeSeatIds(["A1", "A1"])).toThrow(ValidationError);
  expect(() => normalizeSeatIds(["A4"])).toThrow("Invalid seat");
});
