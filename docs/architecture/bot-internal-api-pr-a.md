# Bot internal API — PR A (auth + eligibility + studio kill-switch)

Дата: 2026-08-03  
Статус: implemented locally (CURSOR-15 Stage 3A / PR A)

## Scope

Добавлено:

1. S2S Bearer-auth helper: `src/lib/auth/bot-internal-auth.ts`
2. Internal eligibility: `POST /api/internal/bot/v1/eligibility`
3. Серверное enforcement `StudioSettings.isOnlineBookingEnabled` в `assertOnlineBookable`
4. Отдельный rate-limit bucket `botInternal`
5. CSRF exemption для `/api/internal/*` (Bearer, не browser session)

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

## Eligibility contract

Request:

```json
{
  "serviceId": "<uuid>",
  "masterId": "<uuid?>",
  "includeAlternatives": false
}
```

Unknown fields → `400 VALIDATION_ERROR`.

Success:

```json
{
  "ok": true,
  "outcome": "SELF_BOOKING_ALLOWED" | "MANAGER_HANDOFF",
  "reasonCode": null | "STUDIO_ONLINE_DISABLED" | "SERVICE_INACTIVE" | "SERVICE_NOT_FOUND" | "MASTER_INACTIVE" | "ONLINE_DISABLED" | "MASTER_SERVICE_UNAVAILABLE" | "MANAGER_ONLY",
  "selectedPairAllowed": boolean,
  "serviceOnlineInGeneral": boolean,
  "otherOnlineMasterCount": number,
  "otherOnlineMasters": [{ "id": "...", "publicName": "..." }]
}
```

`otherOnlineMasters` только при `includeAlternatives: true`.

Правила:

- SoT = существующая AND-цепочка + studio kill-switch
- Закрытый выбранный мастер (`Master.isOnlineBookingEnabled=false`) → **не** авто-замена
- Другие ONLINE-мастера — только metadata alternatives; bot покажет их после явного согласия клиента
- Internal API не возвращает клиентский текст и internal notes

## Studio kill-switch

`assertStudioOnlineBookingEnabled` вызывается из `assertOnlineBookable` (slots/create path).

Studio off:

- self-booking denied (`OnlineServiceUnavailableError` / `SERVICE_UNAVAILABLE`)
- eligibility → `MANAGER_HANDOFF` + `STUDIO_ONLINE_DISABLED`
- manager-request остаётся доступным (PR C; не блокируется здесь)

## Tests

```bash
npm run test:security:bot-internal-api-pr-a
npm run test:security:master-service-access-rules
npx tsx scripts/security-csrf-coverage-check.ts
```

## Public regression

Public booking routes (`/api/booking/*`) не меняют CSRF/same-origin модель и source `ONLINE`. Internal path additive.
