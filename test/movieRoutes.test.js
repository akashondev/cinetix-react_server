const mockFindById = jest.fn();
const mockDeleteOne = jest.fn();
const mockFindByIdAndDelete = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockFind = jest.fn();
const mockSynchronizeTmdbMovies = jest.fn();

jest.mock("../models/movie", () => ({
  findById: mockFindById,
  deleteOne: mockDeleteOne,
  findByIdAndDelete: mockFindByIdAndDelete,
  findByIdAndUpdate: mockFindByIdAndUpdate,
  find: mockFind,
}));
jest.mock("../services/tmdbSyncService", () => ({
  DAY_MS: 24 * 60 * 60 * 1000,
  synchronizeTmdbMovies: mockSynchronizeTmdbMovies,
}));

const request = require("supertest");
const app = require("../app");

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteOne.mockResolvedValue({ deletedCount: 1 });
  mockSynchronizeTmdbMovies.mockResolvedValue({ skipped: false, imported: 1 });
  mockFindByIdAndUpdate.mockResolvedValue({ _id: "507f1f77bcf86cd799439013" });
  mockFind.mockResolvedValue([]);
});

test("admin deletion removes a TMDB movie before syncing its replacement", async () => {
  mockFindById.mockResolvedValue({
    _id: "507f1f77bcf86cd799439011",
    source: "tmdb",
    tmdbId: 42,
  });

  const response = await request(app).delete(
    "/api/movies/507f1f77bcf86cd799439011"
  );

  expect(response.status).toBe(200);
  expect(mockDeleteOne).toHaveBeenCalledWith({ _id: "507f1f77bcf86cd799439011" });
  expect(mockSynchronizeTmdbMovies).toHaveBeenCalledWith(
    expect.objectContaining({ excludeTmdbIds: [42] })
  );
  expect(mockDeleteOne.mock.invocationCallOrder[0]).toBeLessThan(
    mockSynchronizeTmdbMovies.mock.invocationCallOrder[0]
  );
});

test("manual movie deletion also triggers a replacement sync", async () => {
  mockFindById.mockResolvedValue({
    _id: "507f1f77bcf86cd799439012",
    source: "manual",
  });

  const response = await request(app).delete(
    "/api/movies/507f1f77bcf86cd799439012"
  );

  expect(response.status).toBe(200);
  expect(mockSynchronizeTmdbMovies).toHaveBeenCalledWith({ excludeTmdbIds: [] });
  expect(mockDeleteOne).toHaveBeenCalledTimes(1);
});

test("partial movie updates do not clear stored image fields", async () => {
  const response = await request(app)
    .put("/api/movies/507f1f77bcf86cd799439013")
    .send({ title: "Updated title" });

  expect(response.status).toBe(200);
  expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
    "507f1f77bcf86cd799439013",
    { title: "Updated title" },
    { new: true }
  );
});

test("public movie listing excludes inactive TMDB records", async () => {
  const response = await request(app).get("/api/movies");

  expect(response.status).toBe(200);
  expect(mockFind).toHaveBeenCalledWith({
    $or: [{ source: { $ne: "tmdb" } }, { isActive: true }],
  });
});

test("admin movie listing can include inactive TMDB records", async () => {
  const response = await request(app).get("/api/movies?includeInactive=true");

  expect(response.status).toBe(200);
  expect(mockFind).toHaveBeenCalledWith({});
});

test("public movie listing excludes stale coming soon records", async () => {
  mockFind.mockResolvedValue([
    ...Array.from({ length: 10 }, (_, index) => ({
      _id: `tmdb-${index}`,
      source: "tmdb",
      category: "comingSoon",
      releaseDate: "2099-01-01",
      originGroup: index < 5 ? "indian" : "international",
    })),
    { _id: "legacy-1", source: "manual", category: "comingSoon", releaseDate: "2020-01-01" },
    { _id: "legacy-2", source: "manual", category: "comingSoon", releaseDate: "2020-01-02" },
  ]);

  const response = await request(app).get("/api/movies");

  expect(response.status).toBe(200);
  expect(response.body).toHaveLength(10);
  expect(response.body.filter((movie) => movie.originGroup === "indian")).toHaveLength(5);
  expect(response.body.filter((movie) => movie.originGroup === "international")).toHaveLength(5);
});

test("public movie listing caps TMDB now showing at fifteen without removing manual movies", async () => {
  mockFind.mockResolvedValue([
    ...Array.from({ length: 16 }, (_, index) => ({
      _id: `tmdb-${index}`,
      source: "tmdb",
      category: "nowShowing",
      isActive: true,
      releaseDate: "2020-01-01",
    })),
    { _id: "manual-1", source: "manual", category: "nowShowing", releaseDate: "2020-01-01" },
  ]);

  const response = await request(app).get("/api/movies");

  expect(response.status).toBe(200);
  expect(response.body.filter((movie) => movie.source === "tmdb")).toHaveLength(15);
  expect(response.body.find((movie) => movie.source === "manual")).toBeDefined();
});
