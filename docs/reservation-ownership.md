# Reservation Ownership and Safe Legacy Migration

## Scope and release gate

Phase 3 makes reservation creation, individual lookup, and cancellation authenticated
and owner-scoped in one Backend change. Hotels remain public. No Premium/history,
upgrade, payment, or Frontend feature is included. The authorization part originally
planned alongside Phase 4 is included now: protected creation must never coexist
with public lookup/deletion in a releasable Backend revision.

**Do not deploy this Backend independently.** The existing Frontend has no account
flow and does not send CSRF proof. Release requires a separately reviewed Frontend
update and the staged auth configuration in `authentication-rollout.md`.
Infrastructure PRs #50 and #51 remain unmerged and unmodified by this work.

Phase 4 is not required to close the public authorization paths; it remains a
separate review for any later cancellation retention/status changes. Cancellation
still physically deletes an owned reservation as before; this phase does not add
soft cancellation. The migration never deletes any reservation or hotel.

## Ownership contract

`Reservation.userId` is an optional, immutable Mongoose ObjectId reference to `User`,
with default `null` for compatibility with existing documents. New API reservations
always set it from `req.auth.user._id`, populated from a valid server-side session.
The field is immutable through normal model updates; any future verified-ownership
workflow must be separately reviewed. There is no self-service legacy claim API.

A creation body containing `userId` is rejected with `400`, even if it matches the
current user or is `null`. Query-string identifiers never determine ownership.
Guest name/email remain booking contact fields; they are not proof of ownership.

Lookup and cancellation include both the session user ID and a BSON scalar ObjectId
type guard. Missing/null IDs, string IDs, and arrays containing an otherwise matching
ID are not authorized. The `_id` cancellation fallback uses the same ownership filter;
there is no unrestricted `findByIdAndDelete` path.

| Endpoint | Contract |
| --- | --- |
| `GET /api/reservations/hotels` | Public; existing response retained |
| `POST /api/reservations` | Valid session, exact Origin, JSON and session-bound `X-CSRF-Token`; persists owner from session |
| `GET /api/reservations/lookup/:query` | Valid session; returns one owned match by reservation ID, name or email |
| `DELETE /api/reservations/:id` | Valid session, exact Origin, JSON `{}`, and `X-CSRF-Token`; owner-scoped ID and `_id` fallback |

Anonymous/invalid/expired sessions receive `401`. Foreign and unowned reservations
receive the same `404` as absent records, including name/email searches. Startup or
DB unavailability blocks protected routes with `503`. Invalid Origin/CSRF returns
`403`; malformed JSON `400`; unsupported media type/encoding `415`; oversized JSON
`413`. Protected JSON is limited to 16 KiB. Protected controller DB errors are
sanitized rather than returning internal details. Responses use `Cache-Control:
no-store`. No-auth factory initialization cannot expose protected reservation routes.

Availability continues to consider every reservation, including unowned legacy
records: protecting a record must not release its hotel dates. The existing
find-then-save availability check is not atomic under concurrent requests.

Owner-scoped reads target the primary, and reservation writes use majority concern
with a five-second acknowledgement timeout. No new index is introduced by this phase;
the existing ID indexes are retained. The compatibility lookup uses a name/email/ID
`$or` and can require a collection scan even for an ID-like query. Evaluate explicit
owner/lookup indexes or an ID-only contract before larger loads.

## Non-destructive migration

`src/services/reservationMigration.js` works on a supplied native database, without
model imports, Mongoose setters, timestamps, DDL, matching users by name/email, or
reservation/hotel deletion. The CLI does not import the app or its models.

Default / `--dry-run` only reports counts:

- `total`: all reservation documents.
- `missingOwner`: no `userId` field.
- `nullOwner`: scalar null.
- `owned`: scalar ObjectId values (not a certification of verified ownership).
- `invalidOwnerType`: other BSON types, including arrays/strings.
- `orphanedOwner`: ObjectId references with no current user; a subset of `owned`.

Reports contain no names, emails, reservation IDs, session values, or connection URI.
Dry-run does not create collections/indexes or modify documents.

`--apply` performs only this conditional update:

```javascript
{ userId: { $exists: false } } -> { $set: { userId: null } }
```

It does not grant ownership. Existing null, owned, orphaned, and malformed values
remain untouched. The filter preserves an owner set before the update. Raw operations
preserve `createdAt`, `updatedAt`, unknown historical fields, and all hotel data.
Subsequent runs modify zero already-normalized documents. Counts can change during
concurrent traffic; this is not a transactionally consistent before/after snapshot.
A timeout may represent partial progress; inspect a fresh dry-run and rerun safely.

Run the following from the Backend repository only against an explicitly approved
target. Provision `MONGO_URL` through the approved secret/environment mechanism with
an explicit database path; do not put credentials in shell history or Git.

```bash
npm run migrate:ownership
npm run migrate:ownership -- --dry-run
npm run migrate:ownership -- --apply --confirm-database <approved-database-name>
```

Apply requires the exact selected database name, verified before connecting; it is
not implied by approval to implement the script. Invalid/conflicting flags fail.
Neither startup nor CI runs the CLI against `MONGO_URL`. CI migration tests use only
a disposable loopback MongoDB process with an explicitly generated test URI.

Before any real apply: verify backup/restore, target host/database, operator rights,
a dry-run report, and approval for that specific migration. After apply, verify
counts, unchanged hotel/booking fields, denied legacy access and repeat-run results.
Do not clean up malformed/orphaned owners automatically. Any association requires
independent ownership evidence and a separately approved workflow, never email/name
matching or account registration alone. Existing ObjectId values also require an
operator provenance review before treating them as previously verified assignments.

## Frontend and coordinated release prerequisites

The existing client files `Pipeline360-Frontend/src/index.html`, `script.js`,
`lookup-script.js`, and `dialogs.js` were inspected but are not changed here.
A separate Frontend change must:

1. Provide registration/login/logout and restore the session with `/api/auth/me`.
2. Obtain `/api/auth/csrf` after authentication/rotation and send `X-CSRF-Token`,
   same-origin cookies, and JSON on reservation creation/cancellation. DELETE sends
   `{}`. Never send `userId`, and never store the HttpOnly session ID in JavaScript.
   Render guest/hotel/API fields with safe DOM text operations rather than HTML
   interpolation.
3. Treat `401` as expired login, `403` as rejected request proof, and `404` as a
   generic absent/inaccessible reservation without offering a legacy claim shortcut.
4. Clearly explain protected legacy reservations and keep hotel browsing public.

Staging configuration follows `authentication-rollout.md`: ConfigMap first, then
Deployment env references, then a separately approved compatible image update.
Do not merge #50/#51 or any new automated image PR as part of this implementation.

A rolling deployment containing old public lookup/deletion Pods and new protected
Pods is unsafe. Before a coordinated release, use a separately approved ingress or
maintenance control to block external creation/lookup/deletion at every entry point
(including direct Frontend proxy access) until every
Backend replica is on the protected version and the compatible Frontend is ready.
An Ingress-only block is insufficient if another proxy/service path remains exposed.
If all paths cannot be blocked, do not deploy. Do not trust readiness alone to hide
old healthy public Pods. Rehearse this cutover
and the inverse rollback in an isolated environment; those controls are not added
by this PR. Never roll back to the public Backend while reservation traffic is open.

## Validation

Run `npm ci` then `npm test` from the Backend repository. The 42 API regression tests
retain their scenarios with authenticated fixtures and the intended owner-filter,
CSRF, fallback, and sanitized-error contract changes. Existing auth/lifecycle tests
are retained; the public-reservation scenario now expects authenticated ownership.

`npm run test:ownership` starts a private MongoDB 7.0.24 process. Tests cover persisted
ownership, five app instances, forged owner IDs, anonymous and cross-user denial,
CSRF/expiry, missing/null/malformed legacy owner isolation, both cancellation IDs,
legacy availability, dry-run metadata/no-write monitoring, data preservation,
repeatable apply, existing owner preservation, and CLI defaults/confirmation.
No real reservation, hotel, Infrastructure, or Kubernetes state is touched.
