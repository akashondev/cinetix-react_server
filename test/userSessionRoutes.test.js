const mockUser = {
  _id: "507f1f77bcf86cd799439012",
  email: "user@example.com",
  name: "User",
  password: "hashed-password",
};
const mockSessionFindOneAndUpdate = jest.fn();
const mockSessionDeleteOne = jest.fn();

jest.mock("../models/UserModel", () => ({
  findOne: jest.fn().mockResolvedValue(mockUser),
}));

jest.mock("bcryptjs", () => ({
  compare: jest.fn().mockResolvedValue(true),
  genSalt: jest.fn(),
  hash: jest.fn(),
}));

jest.mock("../models/UserSession", () => ({
  create: jest.fn().mockResolvedValue({ _id: "session-1" }),
  findOneAndUpdate: mockSessionFindOneAndUpdate,
  deleteOne: mockSessionDeleteOne,
}));

const request = require("supertest");
process.env.JWT_SECRET = "persistent-session-test-secret";
const app = require("../app");

test("login creates a refresh session that lasts until explicit logout", async () => {
  const response = await request(app).post("/api/users/login").send({
    email: "user@example.com",
    password: "password123",
  });

  expect(response.status).toBe(200);
  expect(response.body).toEqual(
    expect.objectContaining({
      token: expect.any(String),
      refreshToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  );
});

test("refresh exchanges an active refresh session for a new access token", async () => {
  mockSessionFindOneAndUpdate.mockResolvedValue({
    user: "507f1f77bcf86cd799439012",
  });

  const response = await request(app)
    .post("/api/users/session/refresh")
    .send({ refreshToken: "a".repeat(64) });

  expect(response.status).toBe(200);
  expect(response.body.token).toEqual(expect.any(String));
  expect(mockSessionFindOneAndUpdate).toHaveBeenCalledWith(
    { tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    { $set: { lastUsedAt: expect.any(Date) } },
    { new: true }
  );
});

test("logout revokes the refresh session", async () => {
  mockSessionDeleteOne.mockResolvedValue({ deletedCount: 1 });

  const response = await request(app)
    .post("/api/users/session/logout")
    .send({ refreshToken: "b".repeat(64) });

  expect(response.status).toBe(204);
  expect(mockSessionDeleteOne).toHaveBeenCalledWith({
    tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});
