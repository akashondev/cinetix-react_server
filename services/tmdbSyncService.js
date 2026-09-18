const Movie = require("../models/movie");

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const POSTER_BASE_URL = "https://image.tmdb.org/t/p/w780";
const HERO_BASE_URL = "https://image.tmdb.org/t/p/w1280";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_SHOWING_TARGETS = { indian: 8, international: 7 };
const COMING_SOON_PER_GROUP = 5;

function marketDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

function dateKey(value) {
  const parts = marketDateParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

function comingSoonWindow(now = new Date()) {
  const parts = marketDateParts(now);
  const year = Number(parts.year);
  const monthIndex = Number(parts.month) - 1;
  const day = Number(parts.day);
  return {
    fromDate: new Date(Date.UTC(year, monthIndex, day + 1))
      .toISOString()
      .slice(0, 10),
    toDate: new Date(Date.UTC(year, monthIndex + 2, 0))
      .toISOString()
      .slice(0, 10),
  };
}

function originGroupFor(movie) {
  return Array.isArray(movie?.origin_country) && movie.origin_country.includes("IN")
    ? "indian"
    : "international";
}

function isEligibleMovie(movie) {
  return Boolean(
    movie &&
      movie.adult !== true &&
      movie.id &&
      String(movie.title || "").trim() &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(movie.release_date || "")) &&
      movie.poster_path
  );
}

function selectByOrigin(
  movies,
  {
    perGroup,
    excludedIds = new Set(),
    minReleaseDate,
    maxReleaseDate,
  }
) {
  const selected = { indian: [], international: [] };
  const seen = new Set();

  for (const movie of Array.isArray(movies) ? movies : []) {
    if (!isEligibleMovie(movie)) continue;
    if (excludedIds.has(movie.id) || seen.has(movie.id)) {
      continue;
    }
    if (minReleaseDate && movie.release_date < minReleaseDate) continue;
    if (maxReleaseDate && movie.release_date > maxReleaseDate) continue;

    const originGroup = originGroupFor(movie);
    if (selected[originGroup].length >= perGroup) continue;
    selected[originGroup].push({ ...movie, originGroup });
    seen.add(movie.id);

    if (
      selected.indian.length >= perGroup &&
      selected.international.length >= perGroup
    ) {
      break;
    }
  }

  return [...selected.indian, ...selected.international];
}

function roundTmdbRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating > 0
    ? Math.round(rating * 10) / 10
    : null;
}

function formatDuration(runtime) {
  const minutes = Number(runtime);
  if (!Number.isFinite(minutes) || minutes <= 0) return "TBD";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function compareByReleaseAndPopularity(left, right) {
  const releaseOrder = String(right.release_date || "").localeCompare(String(left.release_date || ""));
  if (releaseOrder) return releaseOrder;
  return Number(right.popularity || 0) - Number(left.popularity || 0);
}

function buildMovieDocument(
  summary,
  details,
  category,
  originGroup,
  now = new Date()
) {
  const movie = { ...summary, ...details };
  const director = movie.credits?.crew?.find((person) => person.job === "Director");
  const trailer = movie.videos?.results?.find(
    (video) =>
      video.site === "YouTube" && video.type === "Trailer" && video.official
  ) || movie.videos?.results?.find(
    (video) => video.site === "YouTube" && video.type === "Trailer"
  );
  const releaseDate = String(movie.release_date);

  return {
    tmdbId: movie.id,
    source: "tmdb",
    title: movie.title,
    posterUrl: `${POSTER_BASE_URL}${movie.poster_path}`,
    heroImageUrl: movie.backdrop_path
      ? `${HERO_BASE_URL}${movie.backdrop_path}`
      : `${POSTER_BASE_URL}${movie.poster_path}`,
    rating: roundTmdbRating(movie.vote_average),
    popularity: Number.isFinite(Number(movie.popularity)) ? Number(movie.popularity) : 0,
    duration: formatDuration(movie.runtime),
    genres: Array.isArray(movie.genres)
      ? movie.genres.map((genre) => genre.name).filter(Boolean)
      : [],
    releaseDate,
    director: director?.name || "TBD",
    cast: Array.isArray(movie.credits?.cast)
      ? movie.credits.cast.slice(0, 5).map((person) => person.name).filter(Boolean)
      : [],
    description: movie.overview || "Description unavailable.",
    trailerUrl: trailer
      ? `https://www.youtube.com/watch?v=${trailer.key}`
      : "",
    category,
    originGroup,
    nowShowingSince: category === "nowShowing" ? now : null,
  };
}

function planLifecycle(movies, now = new Date()) {
  const today = dateKey(now);
  const cutoff = new Date(now.getTime() - 30 * DAY_MS);
  const promotions = [];
  const deleteIds = [];

  for (const movie of Array.isArray(movies) ? movies : []) {
    if (movie.source !== "tmdb") continue;
    if (
      movie.category === "comingSoon" &&
      movie.releaseDate &&
      String(movie.releaseDate).slice(0, 10) <= today
    ) {
      promotions.push({
        _id: movie._id,
        nowShowingSince: new Date(`${String(movie.releaseDate).slice(0, 10)}T00:00:00.000Z`),
      });
    }
    if (
      movie.category === "nowShowing" &&
      movie.nowShowingSince &&
      new Date(movie.nowShowingSince) <= cutoff
    ) {
      deleteIds.push(movie._id);
    }
  }

  return { promotions, deleteIds };
}

function createTmdbClient({
  token = process.env.TMDB_API_READ_ACCESS_TOKEN,
  fetchImpl = global.fetch,
  timeoutMs = 15000,
} = {}) {
  if (!token) return null;
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for TMDB synchronization");
  }

  async function request(path, params = {}) {
    const url = new URL(`${TMDB_BASE_URL}${path}`);
    Object.entries({ language: "en-US", ...params }).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`TMDB request failed with status ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchPages(path, params, pageCount = 5) {
    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, index) => index + 1).map((page) =>
        request(path, { ...params, page })
      )
    );
    return pages.flatMap((payload) => payload.results || []);
  }

  return {
    fetchNowShowing({ today }) {
      return fetchPages(
        "/discover/movie",
        {
          region: "IN",
          include_adult: false,
          sort_by: "popularity.desc",
          "primary_release_date.lte": today,
        },
        10
      );
    },
    fetchComingSoon({ fromDate, toDate, originGroup }) {
      return fetchPages("/discover/movie", {
        region: "IN",
        include_adult: false,
        sort_by: "popularity.desc",
        with_release_type: "2|3",
        ...(originGroup === "indian"
          ? { with_origin_country: "IN" }
          : { without_origin_country: "IN" }),
        "primary_release_date.gte": fromDate,
        "primary_release_date.lte": toDate,
      }).then((movies) =>
        originGroup === "indian"
          ? movies.map((movie) => ({
              ...movie,
              origin_country: [
                "IN",
                ...(Array.isArray(movie.origin_country) ? movie.origin_country : []),
              ],
            }))
          : movies
      );
    },
    fetchDetails(tmdbId) {
      return request(`/movie/${tmdbId}`, {
        append_to_response: "credits,videos",
      });
    },
  };
}

async function synchronizeTmdbMovies({
  MovieModel = Movie,
  client = createTmdbClient(),
  now = new Date(),
  excludeTmdbIds = [],
} = {}) {
  if (!client) return { skipped: true, reason: "missing-token" };

  const existingMovies = await MovieModel.find({ source: "tmdb" }).lean();
  const excludedIds = new Set(excludeTmdbIds.map(Number));
  const today = dateKey(now);
  const { fromDate: comingSoonFrom, toDate: nextMonthEnd } = comingSoonWindow(now);

  const [existingDetails, nowShowingPool, indianComingSoonPool, internationalComingSoonPool] = await Promise.all([
    Promise.all(
      existingMovies.map(async (movie) => {
        try {
          return { movie, details: await client.fetchDetails(movie.tmdbId) };
        } catch (error) {
          if (error.status === 404) return { movie, details: null };
          throw error;
        }
      })
    ),
    typeof client.fetchNowShowing === "function"
      ? client.fetchNowShowing({ today })
      : client.fetchNowPlaying(),
    client.fetchComingSoon({
      fromDate: comingSoonFrom,
      toDate: nextMonthEnd,
      originGroup: "indian",
    }),
    client.fetchComingSoon({
      fromDate: comingSoonFrom,
      toDate: nextMonthEnd,
      originGroup: "international",
    }),
  ]);
  const comingSoonPool = [...indianComingSoonPool, ...internationalComingSoonPool];
  const refreshedMovies = existingDetails.map(({ movie, details }) => ({
    ...movie,
    ...(isEligibleMovie(details)
      ? { releaseDate: details.release_date, originGroup: originGroupFor(details) }
      : {}),
    catalogEligible: isEligibleMovie(details),
  }));
  const lifecycle = planLifecycle(refreshedMovies, now);
  const deletedIds = new Set(lifecycle.deleteIds.map(String));
  const promotedIds = new Set(
    lifecycle.promotions.map((promotion) => String(promotion._id))
  );
  const existingCandidates = existingDetails.flatMap(({ movie, details }) => {
    if (!isEligibleMovie(details) || deletedIds.has(String(movie._id))) return [];
    const projectedCategory = promotedIds.has(String(movie._id))
      ? "nowShowing"
      : movie.category;
    const originCountry = details.origin_country || [
      movie.originGroup === "indian" ? "IN" : "US",
    ];
    return [{
      ...details,
      id: movie.tmdbId,
      release_date: details.release_date || movie.releaseDate,
      origin_country: originCountry,
      popularity: Number(details.popularity ?? movie.popularity ?? 0),
      originGroup: originGroupFor({ origin_country: originCountry }),
      projectedCategory,
      existingMovieId: movie._id,
    }];
  });
  const uniqueCandidates = (candidates) => {
    const byId = new Map();
    candidates.forEach((candidate) => {
      if (!byId.has(candidate.id) || candidate.existingMovieId) byId.set(candidate.id, candidate);
    });
    return [...byId.values()];
  };
  const selectCategory = (pool, category, target, { minReleaseDate, maxReleaseDate } = {}) => {
    const selected = [];
    const selectedIds = new Set();
    for (const originGroup of ["indian", "international"]) {
      const candidates = uniqueCandidates(pool)
        .filter((candidate) => {
          if (excludedIds.has(Number(candidate.id)) || candidate.originGroup !== originGroup) return false;
          if (candidate.projectedCategory && candidate.projectedCategory !== category) return false;
          if (minReleaseDate && candidate.release_date < minReleaseDate) return false;
          if (maxReleaseDate && candidate.release_date > maxReleaseDate) return false;
          return isEligibleMovie(candidate);
        })
        .sort(category === "nowShowing"
          ? compareByReleaseAndPopularity
          : (left, right) => String(left.release_date).localeCompare(String(right.release_date)) || compareByReleaseAndPopularity(left, right));
      const groupSelected = candidates.filter((candidate) => !selectedIds.has(candidate.id)).slice(0, target[originGroup]);
      groupSelected.forEach((candidate) => selectedIds.add(candidate.id));
      selected.push(...groupSelected);
    }
    return selected;
  };
  const selectedNow = selectCategory(
    [...existingCandidates, ...nowShowingPool.map((movie) => ({
      ...movie,
      originGroup: originGroupFor(movie),
      projectedCategory: "nowShowing",
    }))],
    "nowShowing",
    NOW_SHOWING_TARGETS,
    { maxReleaseDate: today }
  );
  const selectedNowIds = new Set(selectedNow.map((candidate) => candidate.id));
  const selectedComing = selectCategory(
    [...existingCandidates, ...comingSoonPool.map((movie) => ({
      ...movie,
      originGroup: originGroupFor(movie),
      projectedCategory: "comingSoon",
    }))]
      .filter((candidate) => !selectedNowIds.has(candidate.id)),
    "comingSoon",
    { indian: COMING_SOON_PER_GROUP, international: COMING_SOON_PER_GROUP },
    { minReleaseDate: comingSoonFrom, maxReleaseDate: nextMonthEnd }
  );
  const selectedByExistingId = new Map(
    [...selectedNow, ...selectedComing]
      .filter((candidate) => candidate.existingMovieId)
      .map((candidate) => [String(candidate.existingMovieId), candidate.projectedCategory])
  );
  const idsToDelete = existingMovies
    .filter((movie) => {
      if (deletedIds.has(String(movie._id))) return true;
      const projectedCategory = promotedIds.has(String(movie._id)) ? "nowShowing" : movie.category;
      return ["nowShowing", "comingSoon"].includes(projectedCategory) && !selectedByExistingId.has(String(movie._id));
    })
    .map((movie) => movie._id);

  const selected = [
    ...selectedNow.filter((movie) => !movie.existingMovieId).map((movie) => ({ movie, category: "nowShowing" })),
    ...selectedComing.filter((movie) => !movie.existingMovieId).map((movie) => ({ movie, category: "comingSoon" })),
  ];
  const newDocuments = await Promise.all(
    selected.map(async ({ movie, category }) =>
      buildMovieDocument(
        movie,
        await client.fetchDetails(movie.id),
        category,
        movie.originGroup,
        now
      )
    )
  );
  const refreshedDocuments = existingDetails
    .filter(({ movie }) => !idsToDelete.map(String).includes(String(movie._id)))
    .map(({ movie, details }) => {
      if (!isEligibleMovie(details)) {
        return { _id: movie._id, document: { isActive: false } };
      }
      const category = selectedByExistingId.get(String(movie._id)) || movie.category;
      const document = buildMovieDocument(
        details,
        details,
        category,
        originGroupFor(details),
        now
      );
      document.nowShowingSince =
        category === "nowShowing"
          ? movie.nowShowingSince || now
          : null;
      document.isActive = selectedByExistingId.has(String(movie._id));
      return { _id: movie._id, document };
    });
  newDocuments.forEach((document) => {
    document.isActive = true;
  });

  const writes = [];
  if (idsToDelete.length) {
    writes.push(
      MovieModel.deleteMany({
        _id: { $in: idsToDelete },
        source: "tmdb",
      })
    );
  }
  if (refreshedDocuments.length) {
    writes.push(
      MovieModel.bulkWrite(
        refreshedDocuments.map(({ _id, document }) => ({
          updateOne: {
            filter: { _id, source: "tmdb" },
            update: { $set: document },
          },
        }))
      )
    );
  }
  if (newDocuments.length) {
    writes.push(
      MovieModel.bulkWrite(
        newDocuments.map((document) => ({
          updateOne: {
            filter: { tmdbId: document.tmdbId, source: "tmdb" },
            update: { $setOnInsert: document },
            upsert: true,
          },
        }))
      )
    );
  }
  await Promise.all(writes);

  return {
    skipped: false,
    promoted: lifecycle.promotions.length,
    deleted: idsToDelete.length,
    imported: newDocuments.length,
    refreshed: refreshedDocuments.length,
  };
}

module.exports = {
  DAY_MS,
  buildMovieDocument,
  comingSoonWindow,
  createTmdbClient,
  planLifecycle,
  selectByOrigin,
  synchronizeTmdbMovies,
};
