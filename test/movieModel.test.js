const Movie = require("../models/movie");

test("stores manual movies by default and enforces unique sparse TMDB ids", () => {
  const tmdbId = Movie.schema.path("tmdbId");
  const source = Movie.schema.path("source");

  expect(tmdbId.options.unique).toBe(true);
  expect(tmdbId.options.sparse).toBe(true);
  expect(source.defaultValue).toBe("manual");
  expect(source.enumValues).toEqual(["tmdb", "manual"]);
});

test("stores TMDB popularity for synchronization ranking", () => {
  expect(Movie.schema.path("popularity").instance).toBe("Number");
});
