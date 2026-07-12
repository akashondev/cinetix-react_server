process.env.FRONTEND_URL = "https://cinetix-react.vercel.app";

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
  "https://cinetix-react.vercel.app",
])("allows the configured CORS origin %s", async (origin) => {
  const response = await request(app).get("/").set("Origin", origin);

  expect(response.headers["access-control-allow-origin"]).toBe(origin);
  expect(response.headers["access-control-allow-credentials"]).toBe("true");
});

test("does not allow an unconfigured CORS origin", async () => {
  const response = await request(app).get("/").set("Origin", "https://example.com");

  expect(response.headers["access-control-allow-origin"]).toBeUndefined();
});
