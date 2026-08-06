# Bot internal API — PR A + CURSOR-21 availability + CURSOR-24 booking create

Дата: 2026-08-06
Статус: implemented locally (CURSOR-15 PR A, CURSOR-21 availability, CURSOR-24 write)

## Scope

### PR A (auth + eligibility)

1. S2S Bearer-auth helper: `src/lib/auth/bot-internal-auth.ts`
2. Mandatory bot v1 wrapper: `src/lib/auth/bot-internal-api.ts` (`withBotInternalApi`)
3. Internal eligibility: `POST /api/internal/bot/v1/eligibility`
4. Bounded JSON body reader: `src/lib/bot-api/bounded-json-body.ts` (hard 4096-byte stream limit)
5. Серверное enforcement `StudioSettings.isOnlineBookingEnabled` в `assertOnlineBookable`
6. Public catalog studio projection → `MANAGER_ONLY` when studio self-booking is off
7. Rate-limit bucket `botInternal` (read)
8. CSRF exemption **только** для `/api/internal/bot/v1/*`
9. Static namespace coverage: `scripts/security-bot-internal-route-coverage-check.ts`

### CURSOR-21 (availability)

10. `POST /api/internal/bot/v1/available-days`
11. `POST /api/internal/bot/v1/slots` (server-issued `slotId` `bs1.…`)

### CURSOR-24 (confirmed booking create)

12. `POST /api/internal/bot/v1/bookings` — creates real `Appointment` with `source=BOT`
13. Shared slot codec: `src/lib/booking/bot-slot-id.ts`
14. Application service: `createBotConfirmedBooking` (`BotBookingCreateService`)
15. Persistent idempotency model: `InternalBotBookingOperation`
16. `LegalAcceptanceSource.BOT`
17. Create-specific rate limit: `botInternalBookingCreate` (30 / 15 min)
18. Exact `Content-Type: application/json`
19. Strict client resolution (0 → create, 1 → link, >1 → `CLIENT_AMBIGUOUS`)
20. No public manage token for BOT bookings

**Вне scope CURSOR-24:** bot-TV, VK/MAX, n8n, MCP, amoCRM, transactional outbox / `appointment.created.v1`, game reconciliation, BookingRequest auto-link (нет доказанного active bot/channel evidence на модели), signed selection token, HMAC request signing beyond Bearer.

## Architecture

```text
bot-TV → Authorization: Bearer <BOT_INTERNAL_API_TOKEN>
      → withBotInternalApi (auth + rate-limit policy)
      → /api/internal/bot/v1/bookings
      → Content-Type check → readBoundedJsonBody → parseBotBookingCreateBody
      → createBotConfirmedBooking
           → idempotency claim
           → parseBotSlotId + assertOnlineBookable + getAvailableTimeSlots
           → Serializable tx: client resolve + createBotOnlineAppointment + SUCCEEDED snapshot
      → PostgreSQL
```

Canonical write path (not admin INTERNAL create, not HTTP to `/api/booking/create`):

```text
createBotConfirmedBooking
  → assertOnlineBookable / getAvailableTimeSlots (BookingService)
  → createBotOnlineAppointment (AppointmentService, source=BOT, PUBLIC_ONLINE policy)
  → createAppointmentRecord → runSerializableAppointmentWrite
```

## Env

### `BOT_INTERNAL_API_TOKEN`

- Header: `Authorization: Bearer <token>`
- Min length: 32 printable ASCII bytes
- Optional in global `env.ts`; fail-closed in auth helper
- Server-only; never `NEXT_PUBLIC_*`

### `BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET` (required for booking create)

- Dedicated HMAC secret for bot booking request fingerprints only
- Min 32 UTF-8 bytes; empty / whitespace / placeholders rejected
- **No fallback** to `AUTH_SECRET`, `NEXTAUTH_SECRET`, `BOT_INTERNAL_API_TOKEN`, constants, or random process values
- Missing/invalid config → fail-closed `INTERNAL_ERROR` before idempotency claim / Client / Appointment

### `BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS` (optional)

- Comma-separated previous secrets for rotation-safe fingerprint verification
- Each entry trimmed, ≥32 UTF-8 bytes; empty elements rejected; max 8; no duplicates; must not include current
- Used only when matching an existing operation fingerprint
- New claims are always signed with the **current** secret only
- Never log secret values

### HMAC rotation procedure

1. Generate a new current secret (≥32 random bytes, e.g. `openssl rand -base64 48`).
2. Move the old current value into `BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS` (comma-separated with any still-needed priors).
3. Deploy the application with the new current + previous list.
4. Keep each old secret in previous for at least the idempotency retention window (7 days).
5. On repeated rotations, retain every secret that could still verify non-expired operations.
6. Only after all corresponding rows have expired, remove the obsolete previous secret.
7. Never rotate current and drop old previous in the same deploy.
8. Never substitute auth/session/`BOT_INTERNAL_API_TOKEN` for this dedicated key.

## Bookings contract

### Request (exact object)

```json
{
  "idempotencyKey": "<canonical-lowercase-uuid>",
  "slotId": "bs1.<serviceUuid>.<masterUuid>.YYYY-MM-DD.HHmm",
  "clientName": "Имя",
  "phone": "+79123456789",
  "personalDataConsent": true,
  "offerAcknowledgement": true
}
```

Forbidden: `source`, `serviceId`, `masterId`, `startsAt`, `clientId`, `comment`, game ids, extra fields.
Server always sets `AppointmentSource.BOT`.

### Success response

```json
{
  "ok": true,
  "bookingId": "<uuid>",
  "slotId": "bs1.…",
  "status": "SCHEDULED",
  "startsAt": "YYYY-MM-DDTHH:MM:00+05:00",
  "idempotentReplay": false
}
```

No PII, no manage URL/token, no clientId.

### Rate limit (create)

- Policy `botInternalBookingCreate` (30 / 15 min), process-local in-memory store
- **Security invariant:** single app process/container (compose `app` has no `replicas`/`scale` > 1; no PM2 cluster / Node `cluster.fork`)
- Brief rolling-deploy process overlap may exist; that is a temporary window, **not** steady-state horizontal scaling
- Key includes authenticated bot principal after Bearer auth (not IP-only)
- Envelope: `{ "ok": false, "code": "RATE_LIMITED", "error": "Too many requests" }` (HTTP 429 + `Retry-After`); public RU message unchanged
- Before horizontal scale-out: replace with a shared limiter

### SlotId

- Format `bs1.{serviceId}.{masterId}.{date}.{HHmm}` — unsigned, forgeable
- Codec: `src/lib/booking/bot-slot-id.ts`
- Create always re-validates availability server-side; prior offer is not a reservation

### Idempotency

- Table `internal_bot_booking_operations`
- States: `IN_PROGRESS` | `SUCCEEDED` | `FAILED_RETRYABLE` | `FAILED_FINAL`
- Appointment + SUCCEEDED snapshot in one Serializable transaction
- Fingerprint: keyed HMAC (`bot.booking.create.v1` + NFC name + normalized phone + slotId + consents); no raw PII stored; canonical payload must not be logged
- Verification matches current or any configured previous secret (constant-time per candidate)
- Retention: `expiresAt` (+7d); manual cleanup seam (no worker in CURSOR-24)
- PostgreSQL Gate: `npm run test:security:bot-internal-booking-create-db:required` (`--require-postgres`, fail-closed)
- CI wiring guard (`scripts/lib/bot-booking-create-ci-wiring.ts`): structural YAML checks for job name, postgres service, `pg_isready` health-cmd + interval/retries, `npm ci`, prisma generate/migrate, dedicated HMAC + bot token env, required Gate command, no Gate `if:` / `continue-on-error`, no skip conditions, path filters (prisma, booking service/route/idempotency, fixture/scripts, workflow). Negative mutation suite must reject broken workflows without rewriting the real file.
- **Disposable test DB only:** required suite calls `assertDisposableBotBookingTestDatabase` before any fixture writes. Allowed names need a test marker (`_test` / `test_` / `c24test` / `bot_booking_create`) **and** (`CI=true` or `BOT_BOOKING_CREATE_ALLOW_TEST_DB_MUTATION=true`). Flag alone is insufficient. Forbidden: working DB `tvoe_vremya`, production-like names/hosts, unparseable/missing `DATABASE_URL`.
- Fixture cleanup is scoped by `runId` / `c24test-{runId}` (no broad `deleteMany({})`). Prefer CI disposable DB `bot_booking_create_gate`. **Do not run required suite against local working DB.**
- Concurrency barriers (`createCountdownBarrier`) are test-only (`SECURITY_BATCH_TEST=1`, never when `NODE_ENV=production`); Race A/B `beforeCreate`, C/D `beforeSerializableWrite`, E `beforeClientResolve` (before advisory lock), G `afterClientResolve`.
- Local live PostgreSQL Gate races are **not** claimed passed when PostgreSQL is unavailable.
- GitHub branch protection requiring this Gate job remains a **manual follow-up** (not automated by this PR alone).

### Client semantics

- Raw phone in → server `normalizedPhone`
- 0 matches → create Client under advisory lock
- 1 match → link (no name overwrite)
- >1 → `CLIENT_AMBIGUOUS` (no appointment)

### BookingRequest

- **Not accepted** in CURSOR-24 request schema (`bookingRequestId` omitted)
- Model lacks positive evidence of active bot/channel dialog; phone-only closure forbidden
- Follow-up after channel binding evidence exists

### Legal

- Requires both consents `true`
- Writes `LegalAcceptanceRecord` with `source=BOT` (not `ONLINE_BOOKING`)

## Eligibility contract

See Stage 3A docs: pair-specific outcomes, `selectedPairAllowed` null without masterId, alternatives only with `includeAlternatives=true`.

Outcomes include `SELF_BOOKING_ALLOWED` / `MANAGER_HANDOFF`.
Reason codes include `STUDIO_ONLINE_DISABLED` when studio self-booking is off (internal eligibility only; not exposed on public catalog DTO).

## CSRF + wrapper

Exemption: `pathname.startsWith("/api/internal/bot/v1/")` only.

```ts
import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
export const POST = withBotInternalApi(async (request) => { ... }, {
  rateLimitPolicy: "botInternalBookingCreate", // write routes
});
```

## Tests

```bash
npm run test:security:bot-internal-api-pr-a
npm run test:security:bot-internal-availability
npm run test:security:bot-internal-booking-create
npm run test:security:bot-internal-booking-create-db
npm run test:security:bot-internal-route-coverage
```

DB race opt-in (non-gating, honest skip if PG down): `npm run test:security:bot-internal-booking-create-db`.

Required Gate (fail-closed): `npm run test:security:bot-internal-booking-create-db:required`.

Do **not** run required mode against `tvoe_vremya` or any non-disposable database.

## Public regression

Public booking CSRF/same-origin and source `ONLINE` unchanged. BOT create does not issue manage tokens.
