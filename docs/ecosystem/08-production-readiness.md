# 08 — Production readiness

## Правило

Завершение разработки **не** включает production.
Каждый gate — отдельное OWNER-подтверждение.

## Минимальные блоки готовности

| Блок | Статус на момент DOCS-01 / последующих sync |
| --- | --- |
| Канонические документы экосистемы | `DONE` (`DOCS-01`; `docs/ecosystem/`, `BACKLOG.md`, документационный commit) |
| Ops backup/restore/IHM на сервере | `NOT VERIFIED` / `PARTIAL` → `AUDIT-OPS-02` |
| Свежий аудит Bot Core | `DONE` — `AUDIT-BOT-01` OWNER PASS (`bot-TV` `main`@`ed1abcc`) |
| Bot Core storage foundation (PG inbox/outbox/ingress) | `DONE` — `BOT-CORE-FOUNDATION-01` (PG-only; Redis не добавлен) |
| Internal Bot API + auth | `NOT DONE` |
| Live booking race-test | `NOT DONE` |
| Согласованный mode contract | `DONE` — `CONTRACT-MODE-01` (deliberate dual-enum; `bot-TV` `main`@`03ed268`, PR #32) |
| M1: S2S read gated by `BOT_MODE`/`EMERGENCY_LOCK` | `DONE` — Settings-bound policy + HTTP pre-I/O check + DI rebind; adversarial APPROVE; PR Gate green (`main`@`03ed268`, PR #32) |
| n8n Error Handler + external monitor | `NOT DONE` |
| Write booking через диалог | `NOT DONE` — запрещено включать до полного checklist |
| Closed test / synthetic exposure | `DONE` — `BOT-CLOSED-TEST-01` (bot-TV PR #33 `main`@`d055231`; admin PR #40 `main`@`1887e06`; CI green). **Не** deploy/live production |
| Production `AUTO_WRITE` | `NOT DONE` — отдельный OWNER write gate; CP `AUTO` ≠ `AUTO_WRITE` |
| AI provider ≠ `NONE` | запрещено включать без OWNER; default `NONE` = `DONE` |
| Публичные каналы | `NOT DONE` — следующий gate `AMO-01`; порядок в [07](./07-integrations-and-rollout.md) |

## Checklist до `AUTO_WRITE: booking`

- [ ] Internal Bot API + S2S + HMAC + timestamp + nonce + replay
- [ ] `actionId`, payload hash, idempotency
- [ ] signed selection token
- [ ] повторная серверная проверка слота
- [ ] серверный расчёт длительности
- [ ] атомарная запись + transactional outbox
- [ ] reconciliation `UNKNOWN`
- [ ] live race-test: 2 concurrent → 1 success, no double book
- [ ] production gate + OWNER
- [x] закрытый тест (`BOT-CLOSED-TEST-01`) — код/CI DONE; deploy/live не утверждается
- [ ] канальные gates после closed test (`AMO-01` → …) пройдены

## Ops checklist (сервер)

См. [../ops/AUDIT-OPS-02.md](../ops/AUDIT-OPS-02.md). Без server evidence не помечать ops как `DONE`.
