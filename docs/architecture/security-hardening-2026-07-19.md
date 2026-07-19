# Security hardening notes (2026-07-19)

Локальные исправления после аудита секретов / публичных API. Phase B manage-token **не** входит в этот набор.

## 1. Игровые заявки: одна открытая на телефон + каталог

**Правило владельца**

- До 3 стартов игры / 24 ч на `game_visitor`.
- До отправки заявки можно переигрывать (новый текущий результат).
- На один нормализованный телефон в рамках одного `GameCatalog` — не более одной **открытой** заявки (`NEW` | `CONTACTED`).
- `CLOSED` освобождает номер для новой игры и новой заявки.
- Новый браузер / инкогнито / новый visitor не обходят phone-правило на submit.
- Разные каталоги не конфликтуют.
- Idempotent retry с тем же `Idempotency-Key` работает.

**Реализация**

- `src/lib/game/game-open-request-policy.ts` — статусы, нормализация телефона, план обработки P2002.
- `BookingRequestService.createGameBookingRequest` — пишет `clientPhoneNormalized` + `gameCatalogId`, проверка в транзакции, `handleGameBookingCreateUniqueViolation`.
- `GameSessionService.assertVisitorCanStartNewGameAttempt` — блокирует старт только если у **этого** visitor есть открытая игровая заявка по каталогу; после `CLOSED` старт снова разрешён.
- Миграция (expand, не применена в этой задаче):
  `prisma/migrations/20260719120000_booking_request_open_game_phone_catalog/migration.sql`
  Partial unique index `booking_requests_open_game_phone_catalog_uidx`.
  Явная транзакция `BEGIN`/`COMMIT` (Prisma PG по умолчанию не оборачивает). Fail-fast `RAISE` до unique index; без auto-close/delete.

**P2002 mapping**

| Target / meta | Поведение |
|---|---|
| open-game phone+catalog index / columns | `GAME_BOOKING_ALREADY_SUBMITTED` |
| `idempotency_key` | idempotent retry (или rethrow, если ряда нет) |
| meta.target отсутствует / пустой | re-query открытой заявки по phone+catalog → open-error только если найдена; иначе rethrow |
| любой другой надёжный unique | rethrow (не маскировать) |

**Тесты:**
`npm run test:security:game-open-request`
`npm run test:security:game-booking-p2002`
`npm run test:security:open-game-phone-catalog-preflight`

## 2. Open redirect после login

`resolveSafeInternalCallbackUrl` / `isSafeInternalCallbackPath` в `src/lib/auth/safe-callback-url.ts`.
Login page использует только безопасный внутренний path; иначе `/schedule`.

**Тесты:** `npm run test:security:safe-callback-url`

## 3. Same-origin для `POST /api/booking/create`

Route вызывает `enforceSameOriginForMutatingRequest` до rate limit (канонический helper).
Путь остаётся в `PUBLIC_MUTATING_API_PATHS` (без admin CSRF cookie gate), но origin проверяется явно.

Покрыто в `test:security:batch2a`.

## 4. Forgot-password rate limit

Policy `passwordResetRequest`: **5 запросов / 15 минут** на fingerprint/IP (как консервативный email side-effect лимит, рядом с `gamePlay`).
Per-user cooldown 60 с сохранён. Публичный ответ при успехе нейтральный; при лимите — стандартный `RATE_LIMITED` 429 без раскрытия email.

## 5. Privacy `POST /api/booking/client-context`

Public DTO сокращён до `{ isFirstVisit, isNewClient }` — достаточно скидке первого визита в booking wizard.
Same-origin + существующий rate limit.

## 6. Security checks sync

- `game-booking-consume`: expected HMAC включает `serviceId`.
- `mail`: example host `smtp.example.com`, не реальный провайдер.

## Preflight (старая схема, read-only)

До `migrate deploy` колонок ещё нет. Скрипты считают **будущие** ключи теми же выражениями, что backfill:

- `scripts/ops/lib/open-game-phone-catalog-preflight.sql`
- Staging: `bash scripts/ops/staging-preflight-open-game-phone-catalog.sh`
- Production: `bash scripts/ops/production-preflight-open-game-phone-catalog.sh` (только после успешного staging)
- Локальная проверка без БД: `npm run test:security:open-game-phone-catalog-preflight`
- Dry-run: `--dry-run` (не печатает env values)

Четыре счётчика (exit ≠ 0, если любой ≠ 0):

1. `conflict_group_count`
2. `conflict_row_count`
3. `open_game_rows_missing_catalog_count`
4. `open_game_rows_invalid_phone_count`

Ничего не закрывает и не удаляет. Legacy NULL catalog / invalid phone — только обнаружение и stop.

## Staging apply checklist (миграция) — не выполнять в этой задаче

1. Backup staging DB.
2. Старосхемный read-only preflight (`staging-preflight-open-game-phone-catalog.sh`).
3. Дождаться всех четырёх счётчиков = 0 (иначе ручной разбор, без auto-fix).
4. Dry-run / ревью `migration.sql` (явный `BEGIN`/`COMMIT`, fail-fast до unique index).
5. `prisma migrate deploy`.
6. Restart нового app image (пишет `client_phone_normalized` / `game_catalog_id`).
7. Post-migration числовая проверка тех же четырёх счётчиков (уже по новым колонкам / или повтор preflight-логики).
8. Smoke: две параллельные игровые заявки с одним телефоном → одна успех, вторая conflict; idempotent retry OK; после `CLOSED` — снова успех.

**Production** — тот же порядок **только после** успешного staging.
