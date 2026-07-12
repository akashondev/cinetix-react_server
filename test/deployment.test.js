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
  "http://localhost:3001",
  "http://localhost:3002",
  "https://cinetix-react.vercel.app",
])("allows the configured CORS origin %s", async (origin) => {
  const response = await request(app).get("/").set("Origin", origin);

  expect(response.headers["access-control-allow-origin"]).toBe(origin);
  expect(response.headers["access-control-allow-credentials"]).toBe("true");
});

test("allows requests without an origin", async () => {
  const response = await request(app).get("/");

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: "ok" });
});

test("returns the required CORS preflight policy", async () => {
  const origin = "https://cinetix-react.vercel.app";
  const response = await request(app)
    .options("/api/movies")
    .set("Origin", origin)
    .set("Access-Control-Request-Method", "PATCH")
    .set("Access-Control-Request-Headers", "Content-Type,Authorization");

  expect(response.status).toBe(204);
  expect(response.headers["access-control-allow-origin"]).toBe(origin);
  expect(response.headers["access-control-allow-methods"]).toBe(
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  expect(response.headers["access-control-allow-headers"]).toBe(
    "Content-Type,Authorization"
  );
});

test("does not allow an unconfigured CORS origin", async () => {
  const response = await request(app).get("/").set("Origin", "https://example.com");

  expect(response.headers["access-control-allow-origin"]).toBeUndefined();
});
