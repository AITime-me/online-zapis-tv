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
| Internal Bot API routes | `NOT DONE` | Нет dedicated internal bot surface |
| S2S + HMAC + timestamp + nonce + replay | `NOT DONE` | |
| `actionId` / payload hash / bot idempotency contract | `NOT DONE` | Есть idempotency у public booking *request*; это не bot write contract и не `actionId` |
| Signed selection token | `NOT DONE` | |
| Transactional outbox для bot write | `NOT DONE` | |
| Reconciliation `UNKNOWN` для bot write | `NOT DONE` | |
| Static double-book check | `PARTIAL` | `scripts/security-appointment-double-book-check.ts` |
| Live concurrent race integration test | `NOT DONE` | `BOOKING-RACE-01` |
| Serializable isolation на create appointment | `PARTIAL` | В коде create path; недостаточно без live race-test |

## Порядок внедрения (backlog)

1. `BOT-API-READ-01` — read-only Internal Bot API
2. `BOT-AUTH-01` — S2S auth, HMAC, timestamp, nonce, replay
3. `BOOKING-RACE-01` — concurrent integration test
4. `BOT-API-WRITE-01` — write API записи (после gates)
