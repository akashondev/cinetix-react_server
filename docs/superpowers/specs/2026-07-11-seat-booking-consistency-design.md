# Seat Booking Consistency Design

## Objective

Make seat availability authoritative, show-specific, concurrency-safe, and live without changing the existing frontend/backend project structure. Preserve all historical tickets while preventing any new double booking.

## Root Causes

The current seat page requests `GET /api/tickets`, which returns only tickets owned by the authenticated user. It therefore cannot represent global availability. It also compares fields that are absent or inconsistently named and does not consistently include date and showtime. When the request or authentication fails, the page silently uses browser-local `allBookings`, so different browsers naturally show different availability.

The backend creates a ticket without checking seat conflicts and without a database uniqueness constraint. Concurrent requests can both read an apparently available seat and both insert a ticket. Periodic frontend refresh and client-side checks only change how often this race is visible; they cannot prevent it.

The frontend stores selected and booked state in several places (`seats`, `selectedSeats`, a ref, navigation state, and local storage). These copies can diverge. It also writes an unconfirmed selection into `allBookings` before payment, which can make seats appear booked locally even when no server booking exists.

## Show Identity

A show is uniquely identified by:

- `movieId`
- normalized `cinema`
- normalized `screen`
- calendar date in `YYYY-MM-DD`
- normalized showtime

The backend constructs a canonical `showKey` from these fields. The frontend sends the individual fields but never constructs or interprets authority from a local key.

Date normalization uses the selected calendar date rather than UTC conversion in the browser. Showtime is stored in one canonical 24-hour form. Cinema and screen are trimmed and normalized consistently by the backend.

## Data Model

Keep `Ticket` as the booking receipt and add a focused `SeatReservation` model. Each document represents one confirmed seat and contains:

- `showKey`
- `seat`
- `ticketId`
- `userId`
- show identity fields needed for queries and auditing
- timestamps

A unique compound index on `{ showKey: 1, seat: 1 }` is the final concurrency guard. One show can use the same seat labels as another show because their `showKey` values differ.

`Ticket` gains `screen`, `showKey`, and a status with `confirmed`, `cancelled`, and `conflicted` values. Existing ticket fields remain available to current ticket displays.

## Availability API

Add a show-scoped availability endpoint under the existing `/api` surface. It accepts the complete show identity and returns:

- canonical show identity
- booked seat IDs
- available count
- total seat count
- `soldOut`
- server update timestamp

The response is not user-specific. Opening or refreshing the seat page always calls this endpoint with cache disabled. API failures remain visible as errors; the client must never substitute local storage or an authenticated user's ticket history.

Duplicate in-flight availability requests are aborted or coalesced. A newer response cannot be overwritten by an older request. Reconnect and window-focus events trigger a fresh authoritative read.

## Atomic Booking Flow

The existing authenticated ticket creation endpoint delegates to a booking service:

1. Validate movie ID, show identity, seat list, seat labels, duplicates, maximum seat count, and required receipt fields.
2. Normalize the show identity and calculate `showKey` on the server.
3. Start a MongoDB session and transaction.
4. Insert one reservation document per selected seat.
5. Create the ticket document and link the reservations to it in the same transaction.
6. Commit the transaction.
7. Return the confirmed ticket and current show availability.

The unique index makes competing inserts deterministic. If any requested seat conflicts, MongoDB rejects the reservation write, the transaction aborts, no partial reservations or ticket remain, and the API returns HTTP `409` with the conflicting seat IDs and refreshed availability. Transaction or infrastructure failures return HTTP `503` without claiming confirmation.

The service treats a repeated `session_id` as idempotent: the same user and identical booking returns the existing result; mismatched reuse is rejected.

## Cancellation

Ticket cancellation runs in a transaction. It changes the ticket status and removes its active seat reservations atomically. After commit, the server broadcasts the refreshed availability for that show. Historical ticket records remain intact.

## Realtime Updates

Add Socket.IO to the existing Express server. Clients join a room derived from the canonical show identity. After a successful booking or cancellation commits, the server broadcasts a show-availability event only to that room.

Realtime messages are an optimization, not the source of truth. On receipt, the client applies the server payload and removes newly unavailable selected seats. On socket connection, reconnection, page focus, or uncertain event ordering, it refetches the availability endpoint. If WebSockets are unavailable, post-booking refresh and a conservative polling fallback keep the page current.

## Frontend State

Refactor `SeatSelectionPage` around one availability hook and derived seat rendering:

- Store booked seat IDs, selected seat IDs, loading, refresh state, and error.
- Derive the seat view and sold-out state with memoization.
- Do not store a second mutable array of rendered seat objects.
- Use functional selection updates and a memoized seat component.
- Disable booked seats, sold-out booking, empty selection, and booking while a request is pending.
- Remove stale selected seats whenever authoritative availability reports a conflict.

`PaymentPage` sends the booking once, prevents duplicate submission, handles `409` by returning the user to current availability with a meaningful message, and only stores receipt-oriented confirmation data after success. Local storage may retain navigation context but never booked-seat authority.

## Sold-Out And Error States

Sold out means the authoritative booked-seat set covers every valid seat in the configured seat map. The seat page displays `All tickets for this show are sold out.` and disables progression.

Loading blocks seat interaction until the initial authoritative response arrives. Availability failures display a retry action without showing seats as available. Booking validation conflicts identify the seats that became unavailable. Authentication, validation, transaction, and network failures have separate messages and never produce a success state.

## Historical Migration

A repeatable migration script preserves every ticket document. It:

1. Normalizes each historical ticket's show identity.
2. Sorts tickets deterministically by creation time and `_id`.
3. Keeps the earliest claim for each show and seat as confirmed.
4. Marks later overlapping tickets `conflicted` and records their conflicting seats.
5. Creates reservation documents only for confirmed, non-conflicting claims.
6. Reports malformed tickets for manual review without deleting them.
7. Creates or verifies the unique reservation index after conflicts are classified.

The script supports a dry run and is idempotent. A backup is required before applying changes to production data.

## Scope Of Refactoring

Expected backend changes are limited to `app.js`, ticket model updates, one reservation model, a booking service, focused route/controller extraction where it reduces duplication, migration code, and tests. The obsolete commented ticket route implementation is removed.

Expected frontend changes are limited to the seat selection and payment flow, a reusable availability hook/API helper, a memoized seat component if justified by profiling, and focused tests. Existing routes and page structure remain intact.

## Testing

Backend tests cover:

- show identity normalization and separation by movie, cinema, screen, date, and time
- current availability for anonymous and authenticated clients
- two concurrent requests for the same seat, with exactly one success
- all-or-nothing behavior for multi-seat conflicts
- transaction rollback
- idempotent retries
- cancellation releasing reservations
- sold-out calculation
- migration dry run, conflict classification, and idempotency

Frontend tests cover:

- initial loading and authoritative fetch
- no local-storage availability fallback
- stale response suppression
- selected-seat removal after live conflicts
- sold-out messaging and disabled progression
- booking conflict, transaction failure, retry, and duplicate-submit prevention
- socket update and reconnect refetch behavior

Verification includes backend tests, frontend tests, production frontend build, and a manual two-client concurrency check against a transaction-capable MongoDB replica set.

## Operational Requirements

MongoDB must run as a replica set or hosted cluster that supports transactions. Index creation and migration run before deploying code that accepts new bookings. Socket.IO deployment must allow WebSocket or long-polling transport and use a shared adapter if the backend later runs multiple instances. Server logs include show key, request/session ID, outcome, and conflict category without logging payment or authentication secrets.

## Success Criteria

- Database uniqueness makes two confirmed reservations for one show and seat impossible.
- A booking for one movie/date/showtime never affects another show.
- Every booking page begins from a fresh database-backed availability response.
- Connected clients receive committed changes immediately and refetch after reconnect.
- Sold-out shows are clearly identified and cannot be submitted.
- Historical tickets are preserved and historical conflicts are explicitly classified.
- The booking flow has one authoritative backend path and substantially less duplicated frontend state.
