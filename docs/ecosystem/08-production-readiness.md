# 08 — Production readiness

## Правило

Завершение разработки **не** включает production.
Каждый gate — отдельное OWNER-подтверждение.

## Минимальные блоки готовности

| Блок | Статус на момент DOCS-01 |
| --- | --- |
| Канонические документы экосистемы | `DONE` (`DOCS-01`; `docs/ecosystem/`, `BACKLOG.md`, документационный commit) |
| Ops backup/restore/IHM на сервере | `NOT VERIFIED` / `PARTIAL` → `AUDIT-OPS-02` |
| Свежий аудит Bot Core | `DONE` — `AUDIT-BOT-01` OWNER PASS (`bot-TV` `main`@`ed1abcc`) |
| Bot Core storage foundation (PG inbox/outbox/ingress) | `DONE` — `BOT-CORE-FOUNDATION-01` (PG-only; Redis не добавлен) |
| Internal Bot API + auth | `NOT DONE` |
| Live booking race-test | `NOT DONE` |
| Согласованный mode contract | `NOT DONE` → `CONTRACT-MODE-01` |
| M1: S2S read gated by `BOT_MODE`/`EMERGENCY_LOCK` | `NOT DONE` — обязательный security gap post-audit (до closed test / write) |
| n8n Error Handler + external monitor | `NOT DONE` |
| Write booking через диалог | `NOT DONE` — запрещено включать до полного checklist |
| AI provider ≠ `NONE` | запрещено включать без OWNER; default `NONE` = `DONE` |
| Публичные каналы | `NOT DONE` — порядок в [07](./07-integrations-and-rollout.md) |

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
- [ ] закрытый тест и предшествующие канальные gates пройдены

## Ops checklist (сервер)

См. [../ops/AUDIT-OPS-02.md](../ops/AUDIT-OPS-02.md). Без server evidence не помечать ops как `DONE`.
