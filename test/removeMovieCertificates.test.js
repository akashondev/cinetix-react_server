const Movie = require("../models/movie");

function loadMigration() {
  let migration;
  expect(() => {
    migration = require("../scripts/remove-movie-certificates");
  }).not.toThrow();
  return migration;
}

function createMovieStore(documents) {
  return {
    collection: {
      async countDocuments() {
        return documents.filter((document) =>
          Object.prototype.hasOwnProperty.call(document, "certificate")
        ).length;
      },
      async updateMany() {
        let modifiedCount = 0;
        documents.forEach((document) => {
          if (Object.prototype.hasOwnProperty.call(document, "certificate")) {
            delete document.certificate;
            modifiedCount += 1;
          }
        });
        return { modifiedCount };
      },
    },
  };
}

test("new movie documents discard certificate data", () => {
  const movie = new Movie({ title: "Dune", certificate: "PG-13" });

  expect(movie.toObject()).not.toHaveProperty("certificate");
});

test("dry run reports legacy certificates without changing documents", async () => {
  const { removeMovieCertificates } = loadMigration();
  const documents = [
    { title: "Dune", certificate: "PG-13" },
    { title: "Arrival" },
  ];

  const result = await removeMovieCertificates({
    MovieModel: createMovieStore(documents),
    dryRun: true,
  });

  expect(result).toEqual({ dryRun: true, matchedCount: 1, modifiedCount: 0 });
  expect(documents[0]).toHaveProperty("certificate", "PG-13");
});

test("apply removes legacy certificates from every matching movie", async () => {
  const { removeMovieCertificates } = loadMigration();
  const documents = [
    { title: "Dune", certificate: "PG-13" },
    { title: "Alien", certificate: "R" },
    { title: "Arrival" },
  ];

  const result = await removeMovieCertificates({
    MovieModel: createMovieStore(documents),
    dryRun: false,
  });

  expect(result).toEqual({ dryRun: false, matchedCount: 2, modifiedCount: 2 });
  expect(documents).toEqual([
    { title: "Dune" },
    { title: "Alien" },
    { title: "Arrival" },
  ]);
});
