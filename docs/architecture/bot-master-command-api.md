# Bot Master Command API — CURSOR-26

Дата: 2026-08-07
Статус: implemented locally (code); pending migration apply + required PostgreSQL race gate

## Scope

Защищённый internal S2S API для будущих команд мастера (Bot Core уже резолвит `masterId`):

1. `POST /api/internal/bot/v1/master/schedule` — расписание мастера за ограниченный диапазон (≤14 дней)
2. `POST /api/internal/bot/v1/master/blocks/close-interval` — закрыть интервал
3. `POST /api/internal/bot/v1/master/blocks/close-day` — закрыть полный день
4. `POST /api/internal/bot/v1/master/blocks/delete` — удалить только собственную `BOT_MASTER_COMMAND` блокировку
5. `POST /api/internal/bot/v1/master/extra-work/create` — доп. окно через ExtraWorkWindow
6. `POST /api/internal/bot/v1/master/extra-work/delete` — безопасно отменить своё окно
7. `POST /api/internal/bot/v1/master/bookings` — запись клиента к этому же мастеру через канонический bot booking write (`createBotOnlineAppointment`)

**Вне scope:** channel binding, NLP, bot-TV/VK/MAX/amoCRM/n8n, HMAC request signing beyond Bearer, manage tokens, public booking UX changes.

## Architecture

```text
bot-TV → Authorization: Bearer <BOT_INTERNAL_API_TOKEN>
      → withBotInternalApi (auth + rate-limit)
      → /api/internal/bot/v1/master/*
      → Content-Type + readBoundedJsonBody + parse*
      → MasterCommandService
           → InternalBotBookingOperation (operationKind domain split)
           → Serializable tx (blocks / extra-work / booking)
      → PostgreSQL
```

### Provenance / ownership

Additive enum `ScheduleResourceOrigin`:

- `ADMIN_UI` — default for existing rows and admin schedule editor
- `BOT_MASTER_COMMAND` — created by master command mutations

Delete/reopen via master API requires:

- `masterId` match
- `origin === BOT_MASTER_COMMAND`

Ownership is **never** inferred from `comment` / `internalReason`.

### Idempotency

Caller-owned durable keys in `InternalBotBookingOperation`:

| operationKind | Endpoint |
| --- | --- |
| `bot.master.block.close-interval.v1` | close-interval |
| `bot.master.block.close-day.v1` | close-day |
| `bot.master.block.delete.v1` | delete block |
| `bot.master.extra-work.create.v1` | extra-work create |
| `bot.master.extra-work.delete.v1` | extra-work delete |
| `bot.master.booking.create.v1` | master bookings |

Rules (same as CURSOR-24):

- same key + same HMAC fingerprint → replay
- same key + different fingerprint → `IDEMPOTENCY_CONFLICT`
- lease / `IN_PROGRESS` → `IDEMPOTENCY_IN_PROGRESS`
- fingerprints use `BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET` (+ previous secrets)
- snapshots contain **no** phone / manage token / raw PII

### Concurrency

- All master mutations run inside `runSerializableAppointmentWrite` (Serializable + P2034/P2010+40001 retry)
- Block create checks appointments inside the same tx (`createScheduleBlockWithDb`)
- Appointment create already sees blocks inside Serializable (existing path)
- Extra-work delete refuses when active appointments overlap the window (`EXTRA_WORK_IN_USE`)
- Master booking reuses phone advisory lock + `createBotOnlineAppointment` (PUBLIC_ONLINE / source=BOT)

### PII

Schedule read uses `mapScheduleDayAppointmentMaster` (clientName, **no** phone).
Responses / logs / idempotency snapshots never include phones or manage tokens.

## Env

Reuses CURSOR-24:

- `BOT_INTERNAL_API_TOKEN`
- `BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET`
- `BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS` (optional)

## Contracts (summary)

### Common

- Auth: `Authorization: Bearer …`
- Body: exact `Content-Type: application/json` (+ optional `charset=utf-8`)
- Max body: 4096 bytes
- Errors: `{ ok:false, code, error }` (fixed English messages)
- Mutations require lowercase canonical UUID `idempotencyKey`
- `masterId` required (already resolved by Bot Core); all mutations scoped to it

### Schedule read

```json
{ "masterId": "<uuid>", "fromDateKey": "YYYY-MM-DD", "toDateKey": "YYYY-MM-DD" }
```

Max inclusive span: 14 days. Success: `{ ok:true, masterId, fromDateKey, toDateKey, days:[…] }`
Days include appointments (no phone), blocks (with `origin`), extraWorkWindows (with `origin`).

### Close interval

```json
{
  "idempotencyKey": "<uuid>",
  "masterId": "<uuid>",
  "dateKey": "YYYY-MM-DD",
  "startTime": "HH:mm",
  "endTime": "HH:mm",
  "blockType": "BREAK|LUNCH|PERSONAL|DO_NOT_BOOK"
}
```

### Close day

```json
{
  "idempotencyKey": "<uuid>",
  "masterId": "<uuid>",
  "dateKey": "YYYY-MM-DD",
  "blockType": "DAY_OFF|VACATION|SICK_LEAVE|DO_NOT_BOOK"
}
```

Refuses when active appointments exist (`APPOINTMENT_CONFLICT`).

### Delete block / extra-work

Ownership-gated. Extra-work delete → `EXTRA_WORK_IN_USE` if overlapping appointments.

### Master booking

```json
{
  "idempotencyKey": "<uuid>",
  "masterId": "<uuid>",
  "slotId": "bs1.…",
  "clientName": "…",
  "phone": "+7…",
  "personalDataConsent": true,
  "offerAcknowledgement": true
}
```

`slotId.masterId` must equal body `masterId` else `MASTER_SCOPE_VIOLATION` / validation.
Canonical phone match only (0 create / 1 link / >1 `CLIENT_AMBIGUOUS`). No name match, no silent merge.

## Schema

Migration `20260807120000_master_command_api`:

- enum `ScheduleResourceOrigin`
- `schedule_blocks.origin` NOT NULL DEFAULT `ADMIN_UI`
- `extra_work_windows.origin` NOT NULL DEFAULT `ADMIN_UI`
- indexes `(master_id, origin)`

## Rate limits

- Read schedule: `botInternal` (120 / 60s)
- Mutations: `botInternalMasterCommand` (60 / 15 min)

## Tests

- `scripts/security-bot-master-command-check.ts` — static + unit (parsers, ownership, PII, wrappers)
- `scripts/security-bot-master-command-db-check.ts` — PostgreSQL races (opt-in disposable DB; `--require-postgres` fail-closed)
- CI: existing `.github/workflows/bot-internal-booking-create-pg-gate.yml` runs `npm run test:security:bot-master-command-db:required` after migrations (same disposable `bot_booking_create_gate` Postgres service; fail-closed)

## Public booking

Unchanged except shared ScheduleBlock/ExtraWork helpers accept optional tx + `origin` (admin path still `ADMIN_UI`).
