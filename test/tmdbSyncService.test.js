function loadService() {
  let service;
  expect(() => {
    service = require("../services/tmdbSyncService");
  }).not.toThrow();
  return service;
}

function candidate(id, originCountry, overrides = {}) {
  return {
    id,
    title: `Movie ${id}`,
    adult: false,
    poster_path: `/poster-${id}.jpg`,
    backdrop_path: `/backdrop-${id}.jpg`,
    release_date: "2026-09-10",
    origin_country: [originCountry],
    vote_average: 8.16,
    ...overrides,
  };
}

test("selects five valid Indian and five international movies", () => {
  const { selectByOrigin } = loadService();
  const movies = [
    ...Array.from({ length: 6 }, (_, index) => candidate(index + 1, "IN")),
    ...Array.from({ length: 6 }, (_, index) => candidate(index + 101, "US")),
    candidate(999, "IN", { adult: true }),
    candidate(1000, "US", { poster_path: null }),
  ];

  const selected = selectByOrigin(movies, {
    perGroup: 5,
  });

  expect(selected.filter((movie) => movie.originGroup === "indian")).toHaveLength(5);
  expect(selected.filter((movie) => movie.originGroup === "international")).toHaveLength(5);
  expect(selected.map((movie) => movie.id)).not.toEqual(expect.arrayContaining([999, 1000]));
});

test("queries TMDB discover for releases through the India-market date", async () => {
  const { createTmdbClient } = loadService();
  let requestedUrl;
  const client = createTmdbClient({
    token: "test-token",
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return { ok: true, json: async () => ({ results: [] }) };
    },
  });

  await client.fetchNowShowing({ today: "2026-09-18" });

  expect(requestedUrl.pathname).toBe("/3/discover/movie");
  expect(requestedUrl.searchParams.get("region")).toBe("IN");
  expect(requestedUrl.searchParams.get("primary_release_date.lte")).toBe("2026-09-18");
  expect(requestedUrl.searchParams.get("sort_by")).toBe("popularity.desc");
});

test("imports a same-day high-popularity TMDB replacement when Now Showing is full", async () => {
  const { synchronizeTmdbMovies } = loadService();
  const existing = Array.from({ length: 15 }, (_, index) => ({
    _id: `existing-${index}`,
    tmdbId: index + 1,
    source: "tmdb",
    category: "nowShowing",
    originGroup: index < 8 ? "indian" : "international",
    releaseDate: "2026-09-17",
    nowShowingSince: new Date("2026-09-17T00:00:00.000Z"),
  }));
  const writes = [];
  const deleted = [];
  const detailFor = (id) => ({
    ...candidate(id, id <= 8 ? "IN" : "US", {
      title: id === 9999 ? "Resident Evil (2026)" : `Existing ${id}`,
      release_date: id === 9999 ? "2026-09-18" : "2026-09-17",
      popularity: id === 1 ? 1 : 10,
    }),
    runtime: 100,
    genres: [],
    credits: { crew: [], cast: [] },
    videos: { results: [] },
  });
  const MovieModel = {
    find: () => ({ lean: async () => existing }),
    bulkWrite: async (operations) => writes.push(operations),
    deleteMany: async (filter) => deleted.push(filter),
  };

  await synchronizeTmdbMovies({
    MovieModel,
    client: {
      fetchNowShowing: async () => [candidate(9999, "IN", {
        title: "Resident Evil (2026)",
        release_date: "2026-09-18",
        popularity: 100,
      })],
      fetchComingSoon: async () => [],
      fetchDetails: async (id) => detailFor(id),
    },
    now: new Date("2026-09-18T12:00:00.000Z"),
  });

  expect(deleted.flatMap((filter) => filter._id.$in)).toContain("existing-0");
  expect(writes.flat().some((operation) =>
    operation.updateOne?.update?.$setOnInsert?.title === "Resident Evil (2026)"
  )).toBe(true);
});

test("fills exactly eight Indian and seven international Now Showing plus five each Coming Soon", async () => {
  const { synchronizeTmdbMovies } = loadService();
  const writes = [];
  const makeDetails = (id, origin, releaseDate, popularity) => ({
    ...candidate(id, origin, { release_date: releaseDate, popularity }),
    runtime: 100,
    genres: [],
    credits: { crew: [], cast: [] },
    videos: { results: [] },
  });
  const nowPool = [
    ...Array.from({ length: 10 }, (_, index) => candidate(index + 1, "IN", { release_date: "2026-09-18", popularity: 100 - index })),
    ...Array.from({ length: 10 }, (_, index) => candidate(index + 101, "US", { release_date: "2026-09-18", popularity: 100 - index })),
  ];
  const comingPool = [
    ...Array.from({ length: 10 }, (_, index) => candidate(index + 201, "IN", { release_date: "2026-09-20", popularity: 100 - index })),
    ...Array.from({ length: 10 }, (_, index) => candidate(index + 301, "US", { release_date: "2026-09-20", popularity: 100 - index })),
  ];
  await synchronizeTmdbMovies({
    MovieModel: {
      find: () => ({ lean: async () => [] }),
      bulkWrite: async (operations) => writes.push(operations),
    },
    client: {
      fetchNowShowing: async () => nowPool,
      fetchComingSoon: async ({ originGroup }) => comingPool.filter((movie) =>
        originGroup === "indian" ? movie.origin_country.includes("IN") : movie.origin_country.includes("US")
      ),
      fetchDetails: async (id) => {
        const source = [...nowPool, ...comingPool].find((movie) => movie.id === id);
        return makeDetails(id, source.origin_country.includes("IN") ? "IN" : "US", source.release_date, source.popularity);
      },
    },
    now: new Date("2026-09-18T12:00:00.000Z"),
  });

  const documents = writes.flat().map((operation) => operation.updateOne?.update?.$setOnInsert).filter(Boolean);
  expect(documents.filter((document) => document.category === "nowShowing" && document.originGroup === "indian")).toHaveLength(8);
  expect(documents.filter((document) => document.category === "nowShowing" && document.originGroup === "international")).toHaveLength(7);
  expect(documents.filter((document) => document.category === "comingSoon" && document.originGroup === "indian")).toHaveLength(5);
  expect(documents.filter((document) => document.category === "comingSoon" && document.originGroup === "international")).toHaveLength(5);
});

test("does not upsert a TMDB id twice when it appears in both discovery pools", async () => {
  const { synchronizeTmdbMovies } = loadService();
  const writes = [];
  const duplicate = candidate(777, "IN", { release_date: "2026-09-18", popularity: 99 });
  const details = {
    ...duplicate,
    runtime: 100,
    genres: [],
    credits: { crew: [], cast: [] },
    videos: { results: [] },
  };

  await synchronizeTmdbMovies({
    MovieModel: {
      find: () => ({ lean: async () => [] }),
      bulkWrite: async (operations) => writes.push(operations),
    },
    client: {
      fetchNowShowing: async () => [duplicate],
      fetchComingSoon: async () => [{ ...duplicate, release_date: "2026-09-20" }],
      fetchDetails: async () => details,
    },
    now: new Date("2026-09-18T12:00:00.000Z"),
  });

  const ids = writes.flat().map((operation) => operation.updateOne?.update?.$setOnInsert?.tmdbId).filter(Boolean);
  expect(ids.filter((id) => id === 777)).toHaveLength(1);
});

test("maps TMDB details into the stored movie contract", () => {
  const { buildMovieDocument } = loadService();
  const summary = candidate(42, "IN");
  const details = {
    ...summary,
    runtime: 166,
    genres: [{ name: "Science Fiction" }, { name: "Adventure" }],
    overview: "A desert epic.",
    credits: {
      crew: [{ job: "Director", name: "Director Name" }],
      cast: Array.from({ length: 6 }, (_, index) => ({ name: `Actor ${index + 1}` })),
    },
    videos: {
      results: [
        { site: "YouTube", type: "Trailer", official: true, key: "trailer-key" },
      ],
    },
  };

  expect(
    buildMovieDocument(
      summary,
      details,
      "nowShowing",
      "indian",
      new Date("2026-09-17T12:00:00.000Z")
    )
  ).toMatchObject({
    tmdbId: 42,
    source: "tmdb",
    title: "Movie 42",
    posterUrl: "https://image.tmdb.org/t/p/w780/poster-42.jpg",
    heroImageUrl: "https://image.tmdb.org/t/p/w1280/backdrop-42.jpg",
    rating: 8.2,
    duration: "2h 46m",
    genres: ["Science Fiction", "Adventure"],
    releaseDate: "2026-09-10",
    director: "Director Name",
    cast: ["Actor 1", "Actor 2", "Actor 3", "Actor 4", "Actor 5"],
    description: "A desert epic.",
    trailerUrl: "https://www.youtube.com/watch?v=trailer-key",
    category: "nowShowing",
    originGroup: "indian",
    nowShowingSince: new Date("2026-09-17T12:00:00.000Z"),
  });
});

test("plans lifecycle changes only for TMDB-imported movies", () => {
  const { planLifecycle } = loadService();
  const movies = [
    { _id: "due", source: "tmdb", category: "comingSoon", releaseDate: "2026-09-17", originGroup: "indian" },
    { _id: "old", source: "tmdb", category: "nowShowing", nowShowingSince: new Date("2026-08-01"), originGroup: "international" },
    { _id: "manual", source: "manual", category: "nowShowing", nowShowingSince: new Date("2026-08-01") },
  ];

  const plan = planLifecycle(movies, new Date("2026-09-17T12:00:00.000Z"));

  expect(plan.promotions).toEqual([
    { _id: "due", nowShowingSince: new Date("2026-09-17T00:00:00.000Z") },
  ]);
  expect(plan.deleteIds).toEqual(["old"]);
  expect(plan.deleteIds).not.toContain("manual");
});

test("promotes releases using the Indian market date", () => {
  const { planLifecycle } = loadService();
  const plan = planLifecycle(
    [{ _id: "due", source: "tmdb", category: "comingSoon", releaseDate: "2026-09-17" }],
    new Date("2026-09-16T19:00:00.000Z")
  );

  expect(plan.promotions).toHaveLength(1);
});

test("limits coming soon discovery to tomorrow through next month", () => {
  const { comingSoonWindow } = loadService();

  expect(comingSoonWindow(new Date("2026-09-17T12:00:00.000Z"))).toEqual({
    fromDate: "2026-09-18",
    toDate: "2026-10-31",
  });
});

test("does not mutate MongoDB when a TMDB request fails", async () => {
  const { synchronizeTmdbMovies } = loadService();
  const mutations = [];
  const MovieModel = {
    find: () => ({ lean: async () => [] }),
    bulkWrite: async () => mutations.push("bulkWrite"),
    deleteMany: async () => mutations.push("deleteMany"),
  };
  const BlockModel = {
    find: () => ({ distinct: async () => [] }),
  };
  const client = {
    fetchNowPlaying: async () => {
      throw new Error("TMDB unavailable");
    },
    fetchComingSoon: async () => [],
    fetchDetails: async () => ({}),
  };

  await expect(
    synchronizeTmdbMovies({ MovieModel, BlockModel, client })
  ).rejects.toThrow("TMDB unavailable");
  expect(mutations).toEqual([]);
});

test("refreshes existing TMDB metadata without replacing manual movies", async () => {
  const { synchronizeTmdbMovies } = loadService();
  const writes = [];
  const existing = {
    _id: "existing-tmdb",
    tmdbId: 42,
    source: "tmdb",
    title: "Old title",
    category: "comingSoon",
    originGroup: "indian",
    releaseDate: "2026-10-20",
  };
  const details = {
    ...candidate(42, "IN", { title: "Updated title", release_date: "2026-10-21" }),
    runtime: 120,
    genres: [],
    credits: { crew: [], cast: [] },
    videos: { results: [] },
  };
  const MovieModel = {
    find: () => ({ lean: async () => [existing] }),
    bulkWrite: async (operations) => writes.push(operations),
    deleteMany: jest.fn(),
  };
  const BlockModel = { find: () => ({ distinct: async () => [] }) };
  const client = {
    fetchNowPlaying: async () => [],
    fetchComingSoon: async () => [],
    fetchDetails: async () => details,
  };

  await synchronizeTmdbMovies({
    MovieModel,
    BlockModel,
    client,
    now: new Date("2026-09-17T12:00:00.000Z"),
  });

  expect(writes.flat()).toContainEqual(
    expect.objectContaining({
      updateOne: expect.objectContaining({
        filter: { _id: "existing-tmdb", source: "tmdb" },
        update: expect.objectContaining({
          $set: expect.objectContaining({
            title: "Updated title",
            releaseDate: "2026-10-21",
          }),
        }),
      }),
    })
  );
});

test("isolates a withdrawn TMDB record instead of aborting synchronization", async () => {
  const { synchronizeTmdbMovies } = loadService();
  const writes = [];
  const MovieModel = {
    find: () => ({
      lean: async () => [
        {
          _id: "withdrawn",
          tmdbId: 404,
          source: "tmdb",
          category: "nowShowing",
          originGroup: "international",
        },
      ],
    }),
    bulkWrite: async (operations) => writes.push(operations),
    deleteMany: jest.fn(),
  };
  const notFound = Object.assign(new Error("not found"), { status: 404 });

  await expect(
    synchronizeTmdbMovies({
      MovieModel,
      BlockModel: { find: () => ({ distinct: async () => [] }) },
      client: {
        fetchNowPlaying: async () => [],
        fetchComingSoon: async () => [],
        fetchDetails: async () => {
          throw notFound;
        },
      },
    })
  ).resolves.toMatchObject({ skipped: false });
  expect(MovieModel.deleteMany).toHaveBeenCalledWith({
    _id: { $in: ["withdrawn"] },
    source: "tmdb",
  });
});

test("keeps eight Indian retained TMDB movies active for the fifteen-title now showing catalog", async () => {
  const { synchronizeTmdbMovies } = loadService();
  const existing = Array.from({ length: 10 }, (_, index) => ({
    _id: `movie-${index + 1}`,
    tmdbId: index + 1,
    source: "tmdb",
    category: "nowShowing",
    originGroup: "indian",
    releaseDate: "2026-09-10",
    nowShowingSince: new Date(`2026-09-${String(index + 10).padStart(2, "0")}T00:00:00.000Z`),
  }));
  const writes = [];
  const MovieModel = {
    find: () => ({ lean: async () => existing }),
    bulkWrite: async (operations) => writes.push(operations),
    deleteMany: jest.fn(),
  };

  await synchronizeTmdbMovies({
    MovieModel,
    BlockModel: { find: () => ({ distinct: async () => [] }) },
    client: {
      fetchNowPlaying: async () => [],
      fetchComingSoon: async () => [],
      fetchDetails: async (id) => ({
        ...candidate(id, "IN"),
        runtime: 120,
        genres: [],
        credits: { crew: [], cast: [] },
        videos: { results: [] },
      }),
    },
    now: new Date("2026-09-17T12:00:00.000Z"),
  });

  const activeValues = writes
    .flat()
    .map((operation) => operation.updateOne?.update?.$set?.isActive)
    .filter((value) => typeof value === "boolean");
  expect(activeValues.filter(Boolean)).toHaveLength(8);
  expect(activeValues.filter((value) => !value)).toHaveLength(0);
  expect(MovieModel.deleteMany).toHaveBeenCalledWith({
    _id: { $in: ["movie-9", "movie-10"] },
    source: "tmdb",
  });
});

test("removes surplus TMDB now showing records without a blocked list", async () => {
  const { synchronizeTmdbMovies } = loadService();
  const existing = Array.from({ length: 16 }, (_, index) => ({
    _id: `movie-${index + 1}`,
    tmdbId: index + 1,
    source: "tmdb",
    category: "nowShowing",
    originGroup: index < 8 ? "indian" : "international",
    releaseDate: "2026-09-10",
    nowShowingSince: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
  }));
  const writes = [];
  const deletes = [];
  const MovieModel = {
    find: () => ({ lean: async () => existing }),
    bulkWrite: async (operations) => writes.push(operations),
    deleteMany: async (filter) => deletes.push(filter),
  };
  await synchronizeTmdbMovies({
    MovieModel,
    client: {
      fetchNowPlaying: async () => [],
      fetchComingSoon: async () => [],
      fetchDetails: async (id) => ({
        ...candidate(id, id <= 8 ? "IN" : "US"),
        runtime: 120,
        genres: [],
        credits: { crew: [], cast: [] },
        videos: { results: [] },
      }),
    },
    now: new Date("2026-09-17T12:00:00.000Z"),
  });

  expect(deletes).toEqual([
    { _id: { $in: ["movie-16"] }, source: "tmdb" },
  ]);
  expect(writes.flat().some((operation) => operation.updateOne?.filter?.source === "manual")).toBe(false);
});

test("requests separate Indian and international coming soon pools", async () => {
  const { synchronizeTmdbMovies } = loadService();
  const poolRequests = [];

  await synchronizeTmdbMovies({
    MovieModel: { find: () => ({ lean: async () => [] }), bulkWrite: jest.fn() },
    BlockModel: { find: () => ({ distinct: async () => [] }) },
    client: {
      fetchNowPlaying: async () => [],
      fetchComingSoon: async (request) => {
        poolRequests.push(request);
        return [];
      },
      fetchDetails: async () => ({}),
    },
  });

  expect(poolRequests.map((request) => request.originGroup)).toEqual(
    expect.arrayContaining(["indian", "international"])
  );
});

test("marks Indian discover candidates with origin country IN", async () => {
  const { createTmdbClient } = loadService();
  const client = createTmdbClient({
    token: "test-token",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ results: [{ id: 1, title: "Indian candidate" }] }),
    }),
  });

  const movies = await client.fetchComingSoon({
    fromDate: "2026-09-19",
    toDate: "2026-10-31",
    originGroup: "indian",
  });

  expect(movies.every((movie) => movie.origin_country.includes("IN"))).toBe(true);
});
