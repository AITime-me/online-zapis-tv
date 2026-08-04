# Bot internal API — PR A (auth + eligibility + studio kill-switch)

Дата: 2026-08-03
Статус: implemented locally (CURSOR-15 Stage 3A / 3A-R / 3C / 3F remediation)

## Scope

Добавлено:

1. S2S Bearer-auth helper: `src/lib/auth/bot-internal-auth.ts`
2. Mandatory bot v1 wrapper: `src/lib/auth/bot-internal-api.ts` (`withBotInternalApi`)
3. Internal eligibility: `POST /api/internal/bot/v1/eligibility`
4. Bounded JSON body reader: `src/lib/bot-api/bounded-json-body.ts` (hard 4096-byte stream limit)
5. Серверное enforcement `StudioSettings.isOnlineBookingEnabled` в `assertOnlineBookable`
6. Public catalog studio projection (service-first + by-master) → `MANAGER_ONLY` when studio self-booking is off
7. Отдельный rate-limit bucket `botInternal`
8. CSRF exemption **только** для `/api/internal/bot/v1/*`
9. Static namespace coverage: `scripts/security-bot-internal-route-coverage-check.ts`

Вне scope PR A: available-days/slots/bookings/manager-requests internal routes, `source: BOT` writes, idempotency store, Prisma migration, bot-TV, rebase onto advanced main.

## Architecture

```text
bot-TV → Authorization: Bearer <BOT_INTERNAL_API_TOKEN>
      → withBotInternalApi (auth + botInternal RL)
      → /api/internal/bot/v1/eligibility
      → readBoundedJsonBody → evaluateBotEligibility
      → PostgreSQL
```

## Env: `BOT_INTERNAL_API_TOKEN`

- Header: `Authorization: Bearer <token>`
- Min length: 32 printable ASCII bytes
- Optional in global `env.ts`; fail-closed in auth helper
- `.env.example` / `.env.production.example`: `BOT_INTERNAL_API_TOKEN=` (name only — never commit a value)
- Server-only; never `NEXT_PUBLIC_*`
- Use a distinct value per environment (staging ≠ production)
- Compose (`docker-compose.staging.yml` / `docker-compose.production.yml`) maps the key into the **app** service only as:
  `BOT_INTERNAL_API_TOKEN: ${BOT_INTERNAL_API_TOKEN:-}`
- Not passed to postgres, migrator, build args, or Dockerfile
- Missing/empty/short token: public app starts; `/api/internal/bot/v1/*` returns 401
- After set or rotation on a host: recreate **only** the app container (no postgres restart)
- Do not set `WHEEL_E2E_ISOLATED` outside isolated wheel E2E (it bypasses endpoint rate limits)
- Real `bot-TV` integration requires a separate acceptance gate and owner authorization

## Public catalog studio kill-switch

`getBookingCatalog` (service-first) and `listServicesForMaster` (by-master)
each read the studio flag **once** per request.

```ts
// service-first
resolveServiceBookingModes(serviceIds, runtime, { selfBookingEnabled: studioOnline })

// by-master
bookingMode = studioOnline ? "ONLINE" : "MANAGER_ONLY"
managerMasterId / managerMasterName = selected master when studio off
```

When `selfBookingEnabled` / studio flag is false:

- ONLINE-capable services are projected as `MANAGER_ONLY`;
- services remain visible;
- selected master is preserved as manager preference metadata;
- public DTO does **not** include internal reason codes;
- wizard `selectService` and `selectServiceFromMaster` both route
  `bookingMode === "MANAGER_ONLY"` into the existing manager-request flow
  (no date/slots calls).

Internal eligibility remains machine-readable (`SELF_BOOKING_ALLOWED` /
`MANAGER_HANDOFF` + reasonCode) and is separate from catalog.

## CSRF + mandatory auth namespace

Exemption: `pathname.startsWith("/api/internal/bot/v1/")` only.

Every `src/app/api/internal/bot/v1/**/route.ts` must export handlers as:

```ts
import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
export const POST = withBotInternalApi(async (request) => { ... });
```

Coverage script (`scripts/security-bot-internal-route-coverage-check.ts`)
uses the TypeScript compiler API (AST). It fails if:

- namespace has zero routes;
- any HTTP method export is a bare function/arrow;
- wrapper appears only in comments, strings, or dead code;
- import is not the **exact** runtime named import
  `import { withBotInternalApi } from "@/lib/auth/bot-internal-api"`
  (no alias, type-only, relative/suffix/fake path, shadowing, or competing binding);
- one method is wrapped while another is raw.

## Body limit

`readBoundedJsonBody`:

- early reject when declared `Content-Length` > 4096;
- stream-read actual bytes; cancel reader on overflow;
- UTF-8 fatal decode; JSON.parse;
- oversized → HTTP 413 `PAYLOAD_TOO_LARGE`;
- auth runs in `withBotInternalApi` **before** body read.

## Auth response

```json
{ "ok": false, "code": "UNAUTHORIZED", "error": "Unauthorized" }
```

## Eligibility contract

See Stage 3A docs: pair-specific outcomes, `selectedPairAllowed` null without masterId, alternatives only with `includeAlternatives=true`.

Reason codes include `STUDIO_ONLINE_DISABLED` when studio self-booking is off (internal eligibility only; not exposed on public catalog DTO).

## Tests

```bash
npm run test:security:bot-internal-api-pr-a
npm run test:security:bot-internal-compose-wiring
npm run test:security:bot-internal-route-coverage
npx tsx scripts/security-csrf-coverage-check.ts
npx tsx scripts/security-master-service-access-rules-check.ts
```

## Public regression

Public booking CSRF/same-origin and source `ONLINE` unchanged. Manager-request remains available when studio self-booking is off.
