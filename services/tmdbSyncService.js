const Movie = require("../models/movie");

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const POSTER_BASE_URL = "https://image.tmdb.org/t/p/w780";
const HERO_BASE_URL = "https://image.tmdb.org/t/p/w1280";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_SHOWING_TARGETS = { indian: 10, international: 5 };
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

function dateKey(value = new Date()) {
  const parts = marketDateParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

function getIndianMarketDate(value = new Date()) {
  return dateKey(value);
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
  if (Array.isArray(movie?.origin_country) && movie.origin_country.includes("IN")) {
    return "indian";
  }
  if (movie?.original_language === "hi") {
    return "indian";
  }
  return "international";
}

function isEligibleMovie(movie) {
  return Boolean(
    movie &&
      movie.adult !== true &&
      (movie.id || movie.tmdbId) &&
      String(movie.title || "").trim() &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(movie.release_date || movie.releaseDate || "")) &&
      (movie.poster_path || movie.posterUrl)
  );
}

function extractTitleFingerprint(title = "") {
  const clean = String(title || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const parts = String(title || "")
    .toLowerCase()
    .split(/[:\-–—]|(?:\bpart\b|\bchapter\b)/i);
  const mainPart = parts[0]?.replace(/[^a-z0-9]+/g, " ").trim() || clean;
  const subPart = parts.slice(1).join(" ").replace(/[^a-z0-9]+/g, " ").trim();

  const rootPart = mainPart
    .replace(/\b(1|2|3|4|5|6|7|8|9|10|i|ii|iii|iv|v|vi|vii|viii|ix|x)\b$/g, "")
    .trim();

  return { clean, mainPart, subPart, rootPart };
}

function areDuplicateTitles(titleA, titleB) {
  if (!titleA || !titleB) return false;
  const fA = extractTitleFingerprint(titleA);
  const fB = extractTitleFingerprint(titleB);

  if (fA.clean === fB.clean) return true;

  if (
    fA.rootPart &&
    fA.rootPart === fB.rootPart &&
    fA.subPart &&
    fB.subPart &&
    (fA.subPart === fB.subPart ||
      fA.subPart.includes(fB.subPart) ||
      fB.subPart.includes(fA.subPart))
  ) {
    return true;
  }

  return false;
}

function isDuplicateMovie(candidate, existing) {
  if (!candidate || !existing) return false;

  const idA = candidate.tmdbId || candidate.id;
  const idB = existing.tmdbId || existing.id;
  if (idA && idB && Number(idA) === Number(idB)) return true;

  const posterA = candidate.posterUrl || (candidate.poster_path ? `${POSTER_BASE_URL}${candidate.poster_path}` : "");
  const posterB = existing.posterUrl || (existing.poster_path ? `${POSTER_BASE_URL}${existing.poster_path}` : "");
  if (posterA && posterB && posterA === posterB) return true;

  const titleA = candidate.title || "";
  const titleB = existing.title || "";
  if (areDuplicateTitles(titleA, titleB)) {
    const hasSubtitle =
      /conclusion|chapter|part\s*3/i.test(titleA) &&
      /conclusion|chapter|part\s*3/i.test(titleB);
    if (hasSubtitle) return true;

    const dateA = String(candidate.releaseDate || candidate.release_date || "").slice(0, 4);
    const dateB = String(existing.releaseDate || existing.release_date || "").slice(0, 4);
    const yearA = parseInt(dateA, 10);
    const yearB = parseInt(dateB, 10);
    if (!Number.isNaN(yearA) && !Number.isNaN(yearB) && Math.abs(yearA - yearB) <= 1) {
      return true;
    }
  }

  return false;
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
  const popDiff = Number(right.popularity || 0) - Number(left.popularity || 0);
  if (popDiff) return popDiff;
  return String(right.release_date || "").localeCompare(String(left.release_date || ""));
}

function compareByPopularity(left, right) {
  const popDiff = Number(right.popularity || 0) - Number(left.popularity || 0);
  if (popDiff) return popDiff;
  return String(left.release_date || "").localeCompare(String(right.release_date || ""));
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
  const releaseDate = String(movie.release_date || movie.releaseDate);

  const posterPath = details?.poster_path || summary?.poster_path;
  const backdropPath = details?.backdrop_path || summary?.backdrop_path;

  return {
    tmdbId: movie.id || movie.tmdbId,
    source: "tmdb",
    title: movie.title,
    posterUrl: posterPath ? `${POSTER_BASE_URL}${posterPath}` : (movie.posterUrl || ""),
    heroImageUrl: backdropPath
      ? `${HERO_BASE_URL}${backdropPath}`
      : posterPath
      ? `${POSTER_BASE_URL}${posterPath}`
      : (movie.heroImageUrl || ""),
    rating: roundTmdbRating(movie.vote_average ?? movie.rating),
    popularity: Number.isFinite(Number(movie.popularity)) ? Number(movie.popularity) : 0,
    duration: formatDuration(movie.runtime),
    genres: Array.isArray(movie.genres)
      ? movie.genres.map((genre) => (typeof genre === "string" ? genre : genre.name)).filter(Boolean)
      : [],
    releaseDate,
    director: director?.name || movie.director || "TBD",
    cast: Array.isArray(movie.credits?.cast)
      ? movie.credits.cast.slice(0, 5).map((person) => person.name).filter(Boolean)
      : Array.isArray(movie.cast)
      ? movie.cast.slice(0, 5)
      : [],
    description: movie.overview || movie.description || "Description unavailable.",
    trailerUrl: trailer
      ? `https://www.youtube.com/watch?v=${trailer.key}`
      : movie.trailerUrl || "",
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
  apiKey = process.env.TMDB_API_KEY,
  fetchImpl = global.fetch,
  timeoutMs = 15000,
} = {}) {
  if (!token && !apiKey) return null;
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for TMDB synchronization");
  }

  async function requestWithRetry(path, params = {}, retries = 2) {
    const url = new URL(`${TMDB_BASE_URL}${path}`);
    const queryParams = { language: "en-US", ...params };
    if (!token && apiKey) {
      queryParams.api_key = apiKey;
    }
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    const headers = {
      accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new Error(`TMDB request failed with status ${response.status}`);
          error.status = response.status;
          throw error;
        }
        return await response.json();
      } catch (err) {
        lastError = err;
        if (err.status === 404 || attempt === retries) {
          throw err;
        }
        await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async function fetchPages(path, params, pageCount = 3) {
    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, index) => index + 1).map((page) =>
        requestWithRetry(path, { ...params, page }).catch((err) => {
          console.warn(`TMDB fetch page ${page} failed:`, err.message);
          return { results: [] };
        })
      )
    );
    return pages.flatMap((payload) => payload?.results || []);
  }

  return {
    async fetchNowShowing({ today } = {}) {
      const targetDate = today || dateKey(new Date());
      const past90 = new Date(Date.now() - 90 * DAY_MS).toISOString().slice(0, 10);

      // 10 popular Hindi movies from India
      const hindiMovies = await fetchPages("/discover/movie", {
        region: "IN",
        with_origin_country: "IN",
        with_original_language: "hi",
        "primary_release_date.gte": past90,
        "primary_release_date.lte": targetDate,
        sort_by: "popularity.desc",
        include_adult: false,
      }, 3);

      // 5 popular Hollywood movies releasing in India
      const hollywoodMovies = await fetchPages("/discover/movie", {
        region: "IN",
        with_origin_country: "US",
        with_original_language: "en",
        "primary_release_date.gte": past90,
        "primary_release_date.lte": targetDate,
        sort_by: "popularity.desc",
        include_adult: false,
      }, 3);

      return [
        ...hindiMovies.map((movie) => ({
          ...movie,
          origin_country: ["IN", ...(Array.isArray(movie.origin_country) ? movie.origin_country : [])],
          originGroup: "indian",
        })),
        ...hollywoodMovies.map((movie) => ({
          ...movie,
          origin_country: ["US", ...(Array.isArray(movie.origin_country) ? movie.origin_country : [])],
          originGroup: "international",
        })),
      ];
    },

    async fetchComingSoon({ fromDate, toDate, originGroup }) {
      if (originGroup === "indian") {
        // 5 most popular upcoming Hindi movies from India
        const movies = await fetchPages("/discover/movie", {
          region: "IN",
          with_origin_country: "IN",
          with_original_language: "hi",
          "primary_release_date.gte": fromDate,
          "primary_release_date.lte": toDate,
          sort_by: "popularity.desc",
          include_adult: false,
        }, 3);
        return movies.map((movie) => ({
          ...movie,
          origin_country: ["IN", ...(Array.isArray(movie.origin_country) ? movie.origin_country : [])],
          originGroup: "indian",
        }));
      }

      // 5 most popular upcoming international movies
      const movies = await fetchPages("/discover/movie", {
        without_origin_country: "IN",
        "primary_release_date.gte": fromDate,
        "primary_release_date.lte": toDate,
        sort_by: "popularity.desc",
        include_adult: false,
      }, 3);
      return movies.map((movie) => ({
        ...movie,
        originGroup: "international",
      }));
    },

    fetchDetails(tmdbId) {
      return requestWithRetry(`/movie/${tmdbId}`, {
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
  const allExistingMovies = await MovieModel.find({}).lean();
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
      : (typeof client.fetchNowPlaying === "function" ? client.fetchNowPlaying() : []),
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
    const list = [];
    for (const candidate of candidates) {
      if (!isEligibleMovie(candidate)) continue;
      const dupeIndex = list.findIndex((existing) => isDuplicateMovie(candidate, existing));
      if (dupeIndex === -1) {
        list.push(candidate);
      } else {
        if (!list[dupeIndex].existingMovieId && (candidate.existingMovieId || candidate.popularity > list[dupeIndex].popularity)) {
          list[dupeIndex] = candidate;
        }
      }
    }
    return list;
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
          : compareByPopularity);
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
      .filter((candidate) => !selectedNowIds.has(candidate.id) && !selectedNow.some((nowMovie) => isDuplicateMovie(candidate, nowMovie))),
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

  // Automatically remove manual duplicates (e.g. rogue Drishyam 3 or manual duplicates of TMDB movies)
  const manualDuplicates = allExistingMovies.filter((movie) => {
    if (movie.source !== "manual") return false;
    return (
      selectedNow.some((s) => isDuplicateMovie(movie, s)) ||
      selectedComing.some((s) => isDuplicateMovie(movie, s))
    );
  });
  if (manualDuplicates.length) {
    idsToDelete.push(...manualDuplicates.map((m) => m._id));
  }

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
  if (manualDuplicates.length) {
    writes.push(
      MovieModel.deleteMany({
        _id: { $in: manualDuplicates.map((m) => m._id) },
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
  COMING_SOON_PER_GROUP,
  DAY_MS,
  NOW_SHOWING_TARGETS,
  areDuplicateTitles,
  buildMovieDocument,
  comingSoonWindow,
  createTmdbClient,
  dateKey,
  extractTitleFingerprint,
  getIndianMarketDate,
  isDuplicateMovie,
  isEligibleMovie,
  originGroupFor,
  planLifecycle,
  selectByOrigin,
  synchronizeTmdbMovies,
};
