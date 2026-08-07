# 04 — Internal Bot API

## Назначение

Версионированный **Internal Bot API** — единственный способ для Bot Core читать и (позже) писать booking-данные в `online-zapis-tv`.

Прямой доступ к PostgreSQL booking **запрещён**.

## Обязательные свойства (до write-сценария)

- Internal Bot API (версионированный контракт);
- S2S authentication;
- HMAC;
- timestamp;
- nonce;
- replay protection;
- `actionId`;
- payload hash;
- idempotency;
- signed selection token;
- повторная серверная проверка слота;
- серверный расчёт длительности;
- атомарная запись;
- transactional outbox;
- reconciliation для `UNKNOWN`;
- live integration race-test: два одновременных запроса на один слот;
- один успешный результат;
- отсутствие двойной записи.

## Фактический статус в `online-zapis-tv`

| Компонент | Статус | Комментарий |
| --- | --- | --- |
| Public booking catalog/slots/create | `DONE` | Клиентский публичный API, не Internal Bot API |
| Internal Bot API read routes | `DONE` | eligibility, available-days, slots (CURSOR-15/21) |
| Internal Bot API booking create | `DONE` | `POST /api/internal/bot/v1/bookings` (CURSOR-24), Bearer + persistent idempotency |
| Internal Bot Master Command API | `IMPLEMENTED` | CURSOR-26 code+ADR; **pending** migration apply + required PG race gate |
| S2S Bearer auth | `DONE` | `BOT_INTERNAL_API_TOKEN`; HMAC/timestamp/nonce request signing ещё нет |
| Bot booking idempotency store | `DONE` | `InternalBotBookingOperation` (booking + master command kinds) |
| Signed selection token | `NOT DONE` | slotId `bs1` unsigned; create re-validates availability |
| Transactional outbox для bot write | `NOT DONE` | Вне CURSOR-24 |
| Reconciliation `UNKNOWN` для bot write | `NOT DONE` | |
| Static double-book check | `PARTIAL` | `scripts/security-appointment-double-book-check.ts` |
| Live concurrent race integration test | `PARTIAL` | bot create DB harness opt-in; full `BOOKING-RACE-01` still open |
| Serializable isolation на create appointment | `DONE` | Create path + bot create reuse |

## Порядок внедрения (backlog)

1. ~~`BOT-API-READ-01`~~ — read-only Internal Bot API
2. `BOT-AUTH-01` — optional HMAC/timestamp/nonce beyond Bearer
3. `BOOKING-RACE-01` — full concurrent integration fixture suite
4. ~~`BOT-API-WRITE-01` (core create)~~ — CURSOR-24; remaining: outbox + channel reconciliation
