# CORS and Movie Fetching Design

## Goal

Make movie fetching work from local React development servers and the deployed Vercel frontend while preserving unrelated UI and application behavior.

## Backend

Configure CORS middleware in `cinetix-backend/app.js` before JSON middleware and all routes. The allowlist contains `http://localhost:3000`, `http://localhost:3001`, `http://localhost:3002`, `https://cinetix-react.vercel.app`, and a non-empty `process.env.FRONTEND_URL`.

Use an origin callback rather than a wildcard. Requests without an `Origin` header remain allowed. Allowlisted origins are accepted; other browser origins receive a CORS error. Permit `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`, with `Content-Type` and `Authorization` request headers. Reuse compatible CORS options for Socket.IO without moving or changing routes.

Add focused backend tests for allowlisted origins, originless requests, preflight headers and methods, and rejected origins.

## Frontend

Treat `REACT_APP_BACKEND_URL` as the API base, with the production value `https://cinetix-api-rcv5.onrender.com/api`. Requests append `/movies` exactly once, producing `https://cinetix-api-rcv5.onrender.com/api/movies` in production.

Normalize movie collection responses before storing or filtering them. Accept either a direct array or `{ movies: [...] }`; all other response shapes become an empty array. Initialize movie collection state with arrays and reset it to arrays after request failures so array operations cannot throw.

Group home-page movies using the exact backend category values `nowShowing` and `comingSoon`. Preserve existing loading, request-error, and empty-result displays. No new search or filter behavior is introduced; existing filters are checked only to ensure they operate on normalized arrays and use the exact category values.

Movie poster rendering uses `movie.image || movie.banner`, with the existing placeholder as the final fallback. Preserve all unrelated presentation and navigation behavior.

Add focused frontend tests for response normalization, exact category grouping, malformed payloads, the production request URL, and image fallback behavior.

## Deployment Settings

Render must define:

```env
NODE_ENV=production
FRONTEND_URL=https://cinetix-react.vercel.app
```

Vercel must define:

```env
REACT_APP_BACKEND_URL=https://cinetix-api-rcv5.onrender.com/api
```

The frontend must be rebuilt and redeployed after changing this build-time environment variable. The backend must be redeployed after setting its environment variables.

## Verification

Run focused backend and frontend regression tests, the complete relevant test suites, and `npm run build` in `cinetix-frontend`. Confirm the generated frontend uses one `/api` segment and that no build errors remain.

## Scope

Do not change unrelated UI, booking logic, authentication behavior, database models, routes, or deployment architecture.
