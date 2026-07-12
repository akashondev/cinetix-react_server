process.env.FRONTEND_URL = "https://cinetix.vercel.app";

const request = require("supertest");
const app = require("../app");

test("returns JSON from the root health-check route", async () => {
  const response = await request(app).get("/");

  expect(response.status).toBe(200);
  expect(response.type).toBe("application/json");
  expect(response.body).toEqual({ status: "ok" });
});

test.each([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "https://cinetix.vercel.app",
])("allows the configured CORS origin %s", async (origin) => {
  const response = await request(app).get("/").set("Origin", origin);

  expect(response.headers["access-control-allow-origin"]).toBe(origin);
});

test("does not allow an unconfigured CORS origin", async () => {
  const response = await request(app).get("/").set("Origin", "https://example.com");

  expect(response.headers["access-control-allow-origin"]).toBeUndefined();
});
