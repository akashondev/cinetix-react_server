# Seat Booking Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build database-authoritative, show-specific seat availability with atomic booking, live updates, sold-out detection, and a smaller React state model.

**Architecture:** MongoDB stores one uniquely indexed reservation per show and seat, while tickets remain immutable booking receipts with explicit lifecycle status. Express exposes show-scoped availability and transactional booking APIs; Socket.IO broadcasts committed availability changes. React derives its seat grid from authoritative booked IDs and local selections, with refetches protecting correctness when realtime delivery is unavailable.

**Tech Stack:** Node.js, Express 4, Mongoose 7, MongoDB transactions, Socket.IO, React 19, React Router, Jest, Supertest, React Testing Library.

## Global Constraints

- Keep the existing `cinetix-backend` and `cinetix-frontend` project structure and existing routes.
- The canonical show identity is movie ID, cinema, screen, `YYYY-MM-DD` calendar date, and normalized 24-hour showtime.
- MongoDB must run as a replica set or hosted cluster that supports transactions.
- Local storage and user ticket history must never be used as seat-availability authority.
- Preserve all historical ticket documents; classify later overlaps as `conflicted` rather than deleting them.
- WebSockets are an optimization; initial load, reconnect, focus, and uncertain state must use the availability API.
- Every production behavior begins with a failing automated test.

## File Map

Backend:

- Create `services/showIdentity.js`: validate and canonicalize show identity.
- Create `models/SeatReservation.js`: one unique record per show/seat.
- Modify `models/Ticket_data.js`: add show identity, lifecycle, conflicts, and idempotency metadata.
- Create `services/bookingService.js`: availability, atomic booking, idempotency, and cancellation.
- Create `routes/booking.js`: HTTP validation/status mapping and realtime broadcast integration.
- Modify `app.js`: app/server separation, route registration, Socket.IO rooms, and startup.
- Create `scripts/migrate-seat-reservations.js`: dry-run/apply historical classification.
- Create `test/*`: unit, API, concurrency, cancellation, and migration coverage.

Frontend:

- Create `src/api/bookingApi.js`: show availability and booking requests.
- Create `src/hooks/useSeatAvailability.js`: request cancellation, realtime subscription, refetch triggers, and polling fallback.
- Create `src/Component/Seat.jsx`: memoized accessible seat control.
- Modify `src/Component/SeatSelectionPage.jsx`: derived seat grid and authoritative states.
- Modify `src/Component/PaymentPage.jsx`: single atomic submit and conflict handling.
- Create focused tests beside the hook/pages.

---

### Task 1: Canonical Show Identity

**Files:**
- Create: `services/showIdentity.js`
- Create: `test/showIdentity.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `normalizeShowIdentity(input)` returning `{ movieId, cinema, screen, date, time, showKey }`.
- Produces: `normalizeSeatIds(seats)` returning a sorted unique array or throwing `ValidationError`.
- Produces: `ValidationError` with a stable `code` property.

- [ ] **Step 1: Add the backend test runner dependencies and script**

Add `jest`, `supertest`, and `mongodb-memory-server` as dev dependencies and set `"test": "jest --runInBand"`.

- [ ] **Step 2: Write failing normalization tests**

Test that `7:30 PM` and `19:30` normalize identically, browser date strings normalize to the selected `YYYY-MM-DD`, whitespace/case normalization is deterministic, each show field changes `showKey`, and duplicate/invalid seats throw `ValidationError`.

```js
expect(normalizeShowIdentity({
  movieId: "507f1f77bcf86cd799439011",
  cinema: " CinePlex ", screen: "Screen 1",
  date: "2026-07-11", time: "7:30 PM",
})).toMatchObject({ date: "2026-07-11", time: "19:30" });
expect(normalizeSeatIds(["A2", "A1"])).toEqual(["A1", "A2"]);
expect(() => normalizeSeatIds(["A1", "A1"])).toThrow("Duplicate seat");
```

- [ ] **Step 3: Verify red**

Run `npm test -- --runTestsByPath test/showIdentity.test.js`; expect module-not-found failure.

- [ ] **Step 4: Implement the canonicalizer**

Use strict ObjectId validation, a `YYYY-MM-DD` regex plus real calendar validation, explicit 12/24-hour parsing, trimmed lowercase identity segments, and `encodeURIComponent`-joined key segments. Accept only seat labels produced by the current grid (`A1` through `F12`, excluding columns 4 and 9), maximum 10 seats.

- [ ] **Step 5: Verify green and commit**

Run the focused test, then `git add package.json package-lock.json services/showIdentity.js test/showIdentity.test.js && git commit -m "test: define canonical show identity"`.

### Task 2: Reservation Model And Ticket Lifecycle

**Files:**
- Create: `models/SeatReservation.js`
- Modify: `models/Ticket_data.js`
- Create: `test/reservationModel.test.js`

**Interfaces:**
- Produces: `SeatReservation` with unique `{ showKey: 1, seat: 1 }` index.
- Extends `Ticket` with `screen`, `showKey`, `status`, `conflictingSeats`, and booking request fingerprint.

- [ ] **Step 1: Write failing schema/index tests**

Assert the reservation schema has the unique compound index and ticket defaults to `confirmed`; assert statuses are limited to `confirmed`, `cancelled`, and `conflicted`.

- [ ] **Step 2: Verify red**

Run `npm test -- --runTestsByPath test/reservationModel.test.js`; expect missing model/fields.

- [ ] **Step 3: Implement minimal schemas**

Store `showKey`, `seat`, `ticketId`, `userId`, canonical show fields, and timestamps in reservations. Add the lifecycle fields without removing existing ticket fields. Keep `session_id` unique.

- [ ] **Step 4: Verify green and commit**

Run focused tests and `git commit -am "feat: add unique seat reservations"` after staging the new model/test.

### Task 3: Transactional Booking Service

**Files:**
- Create: `services/bookingService.js`
- Create: `test/bookingService.test.js`

**Interfaces:**
- Consumes: `normalizeShowIdentity`, `normalizeSeatIds`, `Ticket`, `SeatReservation`.
- Produces: `getAvailability(identity)` returning `{ show, bookedSeats, availableCount, totalSeats, soldOut, updatedAt }`.
- Produces: `createBooking({ userId, payload })` returning `{ ticket, availability }`.
- Produces: `cancelBooking({ userId, ticketId })` returning `{ ticket, availability }`.
- Produces: `SeatConflictError` with `conflictingSeats` and `availability`.

- [ ] **Step 1: Start an in-memory replica set test fixture**

Use `MongoMemoryReplSet` in Jest setup, connect Mongoose once, sync indexes, and clear collections between tests.

- [ ] **Step 2: Write failing availability and isolation tests**

Assert booked IDs are sorted, sold-out uses the existing 80-seat configured grid, and changing movie/date/time/cinema/screen isolates reservations.

- [ ] **Step 3: Write failing concurrency tests**

Submit two `Promise.allSettled` bookings for the same show/seat and assert exactly one confirmation, one `SeatConflictError`, one ticket, and one reservation. Add a multi-seat overlap test proving the losing transaction leaves zero partial reservations.

- [ ] **Step 4: Write failing idempotency and rollback tests**

Assert identical `session_id`, user, and fingerprint returns the original ticket; mismatched reuse fails validation. Force ticket creation failure after reservation insertion and assert rollback removes reservations.

- [ ] **Step 5: Verify red**

Run `npm test -- --runTestsByPath test/bookingService.test.js`; expect missing service exports.

- [ ] **Step 6: Implement the service**

Use `mongoose.startSession()` and `session.withTransaction()`. Insert reservations before the ticket, then attach the created ticket ID to reservations within the transaction. On duplicate key, query requested seats after abort to construct `SeatConflictError`. Use a stable SHA-256 fingerprint of normalized booking fields for idempotency.

- [ ] **Step 7: Verify green and commit**

Run model/service tests and commit `feat: make seat booking atomic`.

### Task 4: Availability, Booking, Cancellation, And Realtime HTTP Layer

**Files:**
- Create: `routes/booking.js`
- Create: `test/bookingRoutes.test.js`
- Modify: `app.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `GET /api/shows/availability` with query identity.
- Preserves: authenticated `POST /api/tickets` and `DELETE /api/tickets/:id`.
- Produces Socket.IO events `show:join`, `show:leave`, and `show:availability`.

- [ ] **Step 1: Add Socket.IO dependencies and write failing API tests**

Test public availability with `Cache-Control: no-store`; `400` validation errors; `201` booking; `409` with conflicts/current availability; `503` transaction failures; authenticated user-ticket listing; and cancellation release.

- [ ] **Step 2: Verify red**

Run `npm test -- --runTestsByPath test/bookingRoutes.test.js`; expect missing endpoints/status mappings.

- [ ] **Step 3: Extract an app factory and server startup**

Export `createApp({ bookingService, auth })` without connecting/listening during imports. Under `require.main === module`, connect MongoDB, create `http.Server`, attach Socket.IO, then listen. Remove duplicate movie GET and obsolete commented ticket route code.

- [ ] **Step 4: Implement routes and committed-event broadcasts**

Route handlers call only the service. Broadcast only after service success, scoped to `availability.show.showKey`. Never emit on `409` or rollback. Keep meaningful JSON `{ success, code, message, ... }` responses.

- [ ] **Step 5: Verify green and commit**

Run all backend tests and commit `feat: expose live show availability`.

### Task 5: Historical Migration

**Files:**
- Create: `scripts/migrate-seat-reservations.js`
- Create: `test/migration.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `planMigration(tickets)` pure classification result.
- Produces: `runMigration({ dryRun })` database executor.
- Adds scripts `migrate:seats:dry-run` and `migrate:seats`.

- [ ] **Step 1: Write failing migration tests**

Test deterministic earliest-wins ordering by `createdAt` then `_id`, later-ticket `conflicted` classification, malformed report entries, no deletion, reservation generation for confirmed claims, and a second run producing no changes.

- [ ] **Step 2: Verify red**

Run `npm test -- --runTestsByPath test/migration.test.js`; expect missing module.

- [ ] **Step 3: Implement dry-run and apply modes**

Default to dry run. Require `--apply` for writes and `MIGRATION_BACKUP_CONFIRMED=true`. Use a transaction for ticket status updates/reservation upserts, print counts only, then call `SeatReservation.syncIndexes()`.

- [ ] **Step 4: Verify green and commit**

Run migration/backend tests and commit `feat: migrate historical seat reservations`.

### Task 6: Frontend Booking API And Availability Hook

**Files:**
- Create: `cinetix-frontend/src/api/bookingApi.js`
- Create: `cinetix-frontend/src/hooks/useSeatAvailability.js`
- Create: `cinetix-frontend/src/hooks/useSeatAvailability.test.js`
- Modify: `cinetix-frontend/package.json`

**Interfaces:**
- Produces: `fetchAvailability(identity, { signal })` and `createBooking(payload, token, { signal })`.
- Produces: `useSeatAvailability(identity)` returning `{ bookedSeats, availability, loading, refreshing, error, refetch }`.

- [ ] **Step 1: Add `socket.io-client` and write failing hook tests**

Test initial fetch, abort on identity/unmount, stale-response suppression, no local-storage fallback, socket update, reconnect/focus refetch, and polling fallback. Inject API/socket factories into the hook for deterministic tests.

- [ ] **Step 2: Verify red**

Run `npm test -- --watchAll=false --runTestsByPath src/hooks/useSeatAvailability.test.js`; expect missing hook.

- [ ] **Step 3: Implement API error types and hook**

Build URLs with `URLSearchParams`, set `cache: "no-store"`, parse JSON once, and throw `BookingApiError(status, code, payload)`. Use one `AbortController` per request, monotonic request IDs, focus/reconnect handlers, show-room join/leave, and a 30-second fallback interval only while disconnected.

- [ ] **Step 4: Verify green and commit in frontend repository**

Run focused tests and commit `feat: add authoritative seat availability hook`.

### Task 7: Refactor Seat Selection UI

**Files:**
- Create: `cinetix-frontend/src/Component/Seat.jsx`
- Modify: `cinetix-frontend/src/Component/SeatSelectionPage.jsx`
- Create: `cinetix-frontend/src/Component/SeatSelectionPage.test.jsx`

**Interfaces:**
- Consumes: `useSeatAvailability(identity)`.
- Produces: navigation to payment with normalized show fields and selected seat IDs only.

- [ ] **Step 1: Write failing page tests**

Test loading blocks the grid; error shows retry without available seats; booked seats are disabled; live conflicts remove selections with a message; selection caps at 10; all 80 seats booked shows exact sold-out copy and disables progression; focus on derived state without local storage booking history.

- [ ] **Step 2: Verify red**

Run the focused test and confirm existing fallback/duplicate-state behavior fails expectations.

- [ ] **Step 3: Implement derived grid and memoized seat**

Keep only `selectedSeats` locally. Define the existing 80-seat map once outside the component, turn booked IDs into a memoized `Set`, and derive each seat status during render. Remove `seats`, `bookedSeats`, `selectedSeatsRef`, manual interval, format-comparison helpers, pre-payment `allBookings` writes, and client ticket-history fetches.

- [ ] **Step 4: Verify green and commit**

Run hook/page tests and commit `refactor: derive seats from live availability`.

### Task 8: Atomic Payment Submission And Conflict UX

**Files:**
- Modify: `cinetix-frontend/src/Component/PaymentPage.jsx`
- Create: `cinetix-frontend/src/Component/PaymentPage.test.jsx`

**Interfaces:**
- Consumes: `createBooking(payload, token)` and navigation state.
- Produces: one confirmed receipt or a return to seat selection with conflict state.

- [ ] **Step 1: Write failing payment tests**

Test double-click sends one request; `409` returns to seats with conflicting IDs/message; `400`, `401`, `503`, and network errors show distinct messages; success stores only receipt data and navigates once.

- [ ] **Step 2: Verify red**

Run focused tests and confirm duplicate/local-storage behavior fails expectations.

- [ ] **Step 3: Implement one guarded submission path**

Replace nested request `try/catch` blocks with one async handler using `isProcessing` as a synchronous guard ref plus button disable. Send `screen` and the selected calendar date without `toISOString()` date drift. Remove `allBookings`, console token/payload logs, alerts for server errors, and delayed duplicate navigation paths.

- [ ] **Step 4: Verify green and commit**

Run focused frontend tests and commit `refactor: handle booking conflicts at payment`.

### Task 9: End-To-End Verification And Operations

**Files:**
- Modify: `cinetix-backend/README.md`
- Modify: `cinetix-frontend/README.md`

**Interfaces:**
- Documents migration/deployment ordering, realtime requirements, and verification commands.

- [ ] **Step 1: Run full automated verification**

Run `npm test` in backend; expect all suites passing. Run `npm test -- --watchAll=false` and `npm run build` in frontend; expect passing tests and successful optimized build.

- [ ] **Step 2: Run migration dry run**

Run `npm run migrate:seats:dry-run`; record confirmed/conflicted/malformed counts without database writes. Do not run apply mode against production automatically.

- [ ] **Step 3: Run manual two-client concurrency check**

Against a non-production replica-set database, open the same show in two browser sessions, select the same seat, and submit concurrently. Verify one `201`, one `409`, one reservation, one confirmed ticket, and immediate sold-seat updates in both clients.

- [ ] **Step 4: Document deployment sequence**

Document: backup, dry run, maintenance window, apply migration, verify unique index, deploy backend, deploy frontend, and monitor conflict/transaction logs. Document Socket.IO sticky-session/shared-adapter requirements for future multi-instance deployment.

- [ ] **Step 5: Review diffs and commit documentation**

Run `git diff --check` and `git status --short` in both repositories, confirm no secrets/build artifacts are staged, then commit README changes as `docs: document seat booking operations`.
