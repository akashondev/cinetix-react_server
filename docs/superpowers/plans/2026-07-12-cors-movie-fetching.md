# CORS and Movie Fetching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed and local React clients fetch and display movies safely from the Render API.

**Architecture:** Express owns one explicit CORS allowlist and callback installed before all routes. React uses its existing centralized API base, normalizes collection responses at the network boundary, filters by exact persisted categories, and gives poster rendering a deterministic fallback chain.

**Tech Stack:** Express 4, `cors`, Jest, Supertest, React 19, Axios, React Testing Library, Create React App

## Global Constraints

- Preserve all unrelated UI, booking, authentication, database, and route behavior.
- Preserve existing uncommitted edits in both repositories.
- Never use `origin: "*"`.
- The production movie URL must be exactly `https://cinetix-api-rcv5.onrender.com/api/movies`.
- Movie collection state and every value passed to `.filter()` must be an array.

---

### Task 1: Express CORS Policy

**Files:**
- Modify: `cinetix-backend/test/deployment.test.js`
- Modify: `cinetix-backend/app.js:21-34`

**Interfaces:**
- Consumes: `process.env.FRONTEND_URL: string | undefined`, request `Origin` header
- Produces: Express `corsOptions` accepted by `cors()` and Socket.IO

- [ ] **Step 1: Write failing CORS regression tests**

Extend the allowed-origin table with `http://localhost:3001` and `http://localhost:3002`. Add an originless request assertion and an `OPTIONS /api/movies` test asserting the request origin, methods `GET,POST,PUT,PATCH,DELETE,OPTIONS`, and headers `Content-Type,Authorization` are returned.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --runTestsByPath test/deployment.test.js`

Expected: FAIL because localhost port 3002 and/or the required preflight policy is absent.

- [ ] **Step 3: Implement the minimal explicit policy**

In `app.js`, add port 3002 and replace the array-valued origin setting with a callback:

```js
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
```

Keep `app.use(cors(corsOptions))` before JSON parsing and every route. Do not alter route order or startup behavior.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --runTestsByPath test/deployment.test.js`

Expected: PASS with all deployment tests successful.

- [ ] **Step 5: Review the backend diff**

Run: `git diff --check && git diff -- app.js test/deployment.test.js`

Expected: no whitespace errors and only the scoped CORS/test changes plus the pre-existing localhost:3001 edit.

---

### Task 2: Safe Movie Fetching and Exact Categories

**Files:**
- Modify: `cinetix-frontend/src/Component/HomePage.test.jsx`
- Modify: `cinetix-frontend/src/Component/HomePage.jsx:87-109`
- Verify: `cinetix-frontend/src/api/movieApi.js`
- Verify: `cinetix-frontend/src/api/movieApi.test.js`
- Verify: `cinetix-frontend/src/config/api.js`

**Interfaces:**
- Consumes: Axios response data as `unknown`; `API_URL` ending in `/api`
- Produces: `nowShowingMovies: Movie[]`, `comingSoonMovies: Movie[]`

- [ ] **Step 1: Write failing home-page tests**

Update fixtures to include exact categories:

```js
[
  { _id: "showing", title: "Showing", category: "nowShowing", banner: "/showing.jpg" },
  { _id: "soon", title: "Soon", category: "comingSoon", banner: "/soon.jpg" },
  { _id: "hidden", title: "Hidden", category: "other", banner: "/hidden.jpg" },
]
```

Assert Axios receives `${process.env.REACT_APP_BACKEND_URL}/movies` (with the test environment set to `https://cinetix-api-rcv5.onrender.com/api` before module loading), that Showing renders under `now-showing`, Soon under `coming-soon`, and Hidden is absent. Add a malformed `{ movies: {} }` response test asserting both existing empty states render without an exception.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --watchAll=false --runTestsByPath src/Component/HomePage.test.jsx src/api/movieApi.test.js`

Expected: FAIL because HomePage currently groups by release date rather than exact categories.

- [ ] **Step 3: Implement exact category filtering**

Keep both state initializers as `useState([])`, normalize `response.data`, and replace date comparisons with:

```js
const movieData = normalizeMovies(response.data);
setNowShowingMovies(movieData.filter((movie) => movie.category === "nowShowing"));
setComingSoonMovies(movieData.filter((movie) => movie.category === "comingSoon"));
```

Keep the current loading, error, and empty-state logic. Retain the centralized request `${API_URL}/movies`; `API_URL` resolves from `process.env.REACT_APP_BACKEND_URL`, preventing hardcoded hosts across the application.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npm test -- --watchAll=false --runTestsByPath src/Component/HomePage.test.jsx src/api/movieApi.test.js`

Expected: PASS with category, malformed-response, and normalization cases successful.

- [ ] **Step 5: Audit movie collection filters and URL composition**

Run: `rg -n "onrender\\.com|localhost:|/api/api|movies\\.filter|category ===" src`

Expected: no hardcoded backend host, no `/api/api`, and movie filters use normalized arrays and exact persisted category strings where data is classified.

---

### Task 3: Movie Poster Fallback

**Files:**
- Modify: `cinetix-frontend/src/Component/MovieCard.test.jsx`
- Modify: `cinetix-frontend/src/Component/MovieCard.jsx:6-35`

**Interfaces:**
- Consumes: `image?: string`, `banner?: string`
- Produces: poster `src` selected as `image || banner || placeholder`

- [ ] **Step 1: Write failing image fallback tests**

Add one test rendering both `image` and `banner` and assert the poster uses `image`. Add another rendering an empty `image` with a banner and assert the poster uses `banner`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --watchAll=false --runTestsByPath src/Component/MovieCard.test.jsx`

Expected: FAIL because `MovieCard` currently ignores `image`.

- [ ] **Step 3: Implement the fallback chain**

Accept `image` and stop defaulting `banner` in the parameter list. Define:

```js
const poster = image || banner || "/api/placeholder/260/360?text=Movie";
```

Set the poster image's `src` to `poster`; do not change card layout or category presentation props.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --watchAll=false --runTestsByPath src/Component/MovieCard.test.jsx`

Expected: PASS with existing geometry tests and both fallback tests successful.

---

### Task 4: Full Verification and Deployment Handoff

**Files:**
- Verify: `cinetix-backend/package.json`
- Verify: `cinetix-frontend/package.json`
- Verify: all modified files

**Interfaces:**
- Consumes: completed Tasks 1-3
- Produces: verified backend test suite, frontend test suite, production build, and deployment settings summary

- [ ] **Step 1: Run all backend tests**

Run from `cinetix-backend`: `npm test`

Expected: exit code 0 and no failed suites.

- [ ] **Step 2: Run all frontend tests once**

Run from `cinetix-frontend`: `npm test -- --watchAll=false`

Expected: exit code 0 and no failed suites.

- [ ] **Step 3: Build the frontend with the production API base**

Run in PowerShell from `cinetix-frontend`:

```powershell
$env:REACT_APP_BACKEND_URL='https://cinetix-api-rcv5.onrender.com/api'; npm run build
```

Expected: exit code 0 and `Compiled successfully.`

- [ ] **Step 4: Inspect final diffs and settings**

Run `git diff --check` and `git status --short` in each repository. Review all diffs, distinguishing the user's pre-existing changes from task changes.

Required Render environment:

```env
NODE_ENV=production
FRONTEND_URL=https://cinetix-react.vercel.app
```

Required Vercel environment:

```env
REACT_APP_BACKEND_URL=https://cinetix-api-rcv5.onrender.com/api
```

- [ ] **Step 5: Report the handoff**

Summarize modified files, test/build evidence, the exact final movie URL, and the required Render/Vercel environment variables. Do not claim remote deployments were changed because this task only modifies and verifies the local repositories.
