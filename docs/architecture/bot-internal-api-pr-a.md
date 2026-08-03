# Bot internal API — PR A (auth + eligibility + studio kill-switch)

Дата: 2026-08-03
Статус: implemented locally (CURSOR-15 Stage 3A / PR A + Stage 3A-R remediation)

## Scope

Добавлено:

1. S2S Bearer-auth helper: `src/lib/auth/bot-internal-auth.ts`
2. Internal eligibility: `POST /api/internal/bot/v1/eligibility`
3. Серверное enforcement `StudioSettings.isOnlineBookingEnabled` в `assertOnlineBookable`
4. Отдельный rate-limit bucket `botInternal`
5. CSRF exemption **только** для `/api/internal/bot/v1/*` (Bearer enforced in-route)

Вне scope PR A: available-days/slots/bookings/manager-requests internal routes, `source: BOT` writes, idempotency store, Prisma migration, bot-TV.

## Architecture

```text
bot-TV → Authorization: Bearer <BOT_INTERNAL_API_TOKEN>
      → /api/internal/bot/v1/eligibility
      → evaluateBotEligibility / BookingService helpers
      → PostgreSQL
```

Thin route only. Policy живёт в service/helpers, не дублируется в handler.

## Env: `BOT_INTERNAL_API_TOKEN`

- Header: `Authorization: Bearer <token>`
- Min length: 32
- No default / no test secret in production code
- `.env.example` содержит только имя: `BOT_INTERNAL_API_TOKEN=`

### Почему optional в global `env.ts`

Глобальная zod-схема (`src/lib/env.ts`) **не требует** токен на старте public/CI runtime:

- иначе local/CI/public build до staging provisioning падал бы при импорте `env`;
- AUTH_SECRET / SCHEDULE_VIEW_TOKEN уже production-required; bot token пока не provisioned.

Fail-closed обеспечивается auth helper:

- missing / short token → `getBotInternalApiToken() === null`
- `enforceBotInternalAuth` всегда отвечает generic `401 UNAUTHORIZED`

Staging/production provisioning — отдельный ops gate перед bot traffic (не часть PR A).

## Auth response

```json
{ "ok": false, "code": "UNAUTHORIZED", "error": "Unauthorized" }
```

Одинаковый ответ для missing header, malformed scheme, wrong token, misconfigured server token. Токен и body не логируются.

## CSRF exemption scope

`requiresAdminCsrfProtection` excludes **only** `/api/internal/bot/v1/*`.

- Unrelated `/api/internal/...` outside bot v1 remains CSRF-protected (admin session + same-origin).
- Bot eligibility route still requires Bearer (`enforceBotInternalAuth`) even with CSRF exemption.
- Public booking routes keep existing same-origin CSRF contract.

## Eligibility contract

Request:

```json
{
  "serviceId": "<uuid>",
  "masterId": "<uuid?>",
  "includeAlternatives": false
}
```

Unknown fields / null optional fields / non-boolean `includeAlternatives` → `400 VALIDATION_ERROR`.
Oversized body (`Content-Length` > 4096) → `400`.

Success:

```json
{
  "ok": true,
  "outcome": "SELF_BOOKING_ALLOWED" | "MANAGER_HANDOFF",
  "reasonCode": null | "STUDIO_ONLINE_DISABLED" | "SERVICE_INACTIVE" | "MASTER_INACTIVE" | "ONLINE_DISABLED" | "MASTER_SERVICE_UNAVAILABLE" | "MANAGER_ONLY",
  "selectedPairAllowed": true | false | null,
  "serviceOnlineInGeneral": boolean,
  "otherOnlineMasterCount": number,
  "otherOnlineMasters": [{ "id": "...", "publicName": "..." }]
}
```

- `selectedPairAllowed` is `null` when `masterId` omitted; boolean when a pair was evaluated.
- `otherOnlineMasters` only when `includeAlternatives: true`.
- Unknown / private / inactive services share `SERVICE_INACTIVE` (no existence leak via `SERVICE_NOT_FOUND`).
- Alternatives come from `listMastersForService` (canonical ONLINE chain), exclude selected master, ordered by `sortOrder`.

Правила:

- SoT = существующая AND-цепочка + studio kill-switch
- Закрытый выбранный мастер (`Master.isOnlineBookingEnabled=false`) → **не** авто-замена
- Другие ONLINE-мастера — только metadata alternatives
- Internal API не возвращает клиентский текст и internal notes

## Studio kill-switch

`assertStudioOnlineBookingEnabled` вызывается из `assertOnlineBookable` (slots/create path).

`getAvailableDaysInMonth` resolves the studio flag once, then reuses a memoized runtime for the day loop (avoids N+1 `StudioSettings` reads).

Missing StudioSettings row: `ensureStudioSettings()` upserts singleton with `DEFAULT_STUDIO_SETTINGS.isOnlineBookingEnabled: true` — same SoT as public settings API.

Studio off:

- self-booking denied (`OnlineServiceUnavailableError` / `SERVICE_UNAVAILABLE`)
- eligibility → `MANAGER_HANDOFF` + `STUDIO_ONLINE_DISABLED`
- manager-request остаётся доступным (не использует `assertOnlineBookable`)

## Tests

```bash
npm run test:security:bot-internal-api-pr-a
npx tsx scripts/security-master-service-access-rules-check.ts
npx tsx scripts/security-csrf-coverage-check.ts
```

## Public regression

Public booking routes (`/api/booking/*`) не меняют CSRF/same-origin модель и source `ONLINE`. Internal path additive.
