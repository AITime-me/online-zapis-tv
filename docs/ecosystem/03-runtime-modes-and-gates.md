# 03 — Runtime modes и gates

## Согласованная последовательность запуска

1. `OFF`
2. synthetic adapter
3. закрытый тест в админке или на тестовой поверхности
4. `HINTS`
5. `DRAFT`
6. `AUTO_READ`
7. отдельный production gate
8. `AUTO_WRITE: booking`

Synthetic / закрытая тестовая поверхность может быть **отдельным exposure gate**, а не обязательно отдельным значением runtime enum Bot Core.

Каждый переход требует **отдельного подтверждения OWNER**.
Завершение разработки **ничего автоматически не включает**.

## Deliberate dual-enum contract (`CONTRACT-MODE-01` — DONE)

Enums **не унифицированы** намеренно. Control plane и Bot Core хранят разные значения;
маппинг явный и OWNER-approved.

| Контур | Enum | Роль |
| --- | --- | --- |
| `online-zapis-tv` control plane | `OFF \| TEST \| HINTS \| DRAFT \| AUTO` | exposure intent |
| `bot-TV` Bot Core | `OFF \| HINTS \| DRAFT \| AUTO_READ \| AUTO_WRITE` | runtime capability |

### Explicit mapping

| Control plane | Bot Core capability |
| --- | --- |
| `OFF` | `OFF` |
| `TEST` | closed-test / admin / synthetic **exposure only** — **не** значение `BOT_MODE` / BotMode |
| `HINTS` | `HINTS` |
| `DRAFT` | `DRAFT` |
| `AUTO` | максимум `AUTO_READ` до отдельного OWNER-approved write gate |

- CP `AUTO` **никогда** молча не означает `AUTO_WRITE`.
- Переход к `AUTO_WRITE` — отдельный system/release OWNER gate (разовый допуск capability, не ручное одобрение каждой записи).
- Invalid / missing Bot Core mode или settings → **fail-closed**.

### Live Booking Service S2S read matrix (M1 — DONE)

Eligibility / availability reads:

| Bot Core mode | `EMERGENCY_LOCK` | Live read |
| --- | --- | --- |
| `OFF` | any | DENY |
| `HINTS` | any | DENY |
| `DRAFT` | any | DENY |
| `AUTO_READ` | `true` | DENY |
| `AUTO_READ` | `false` | ALLOW |
| `AUTO_WRITE` | `true` | DENY |
| `AUTO_WRITE` | `false` | ALLOW |

`EMERGENCY_LOCK=true` имеет **абсолютный** приоритет над режимом.

Booking **writes** и public/channel **outbound** этой задачей **не** включены.
`AUTO_WRITE` как write-capability остаётся будущим отдельным gate.

Evidence: `bot-TV` `main`@`03ed268`, PR #32, `app/core/mode_contract.py`,
Settings-bound M1 enforcement (factory + HTTP pre-I/O + DI rebind);
adversarial re-review APPROVE; GitHub PR Gate SUCCESS.

## Gates (канон)

| Gate | Назначение | Статус |
| --- | --- | --- |
| Runtime mode / `CONTRACT-MODE-01` | Dual-enum contract + M1 live-read gate | `DONE` |
| Exposure / synthetic / closed test | До публичных каналов | `NOT DONE` → следующий gate `BOT-CLOSED-TEST-01` |
| Production gate | Перед write | `NOT DONE` как отдельный enforced gate |
| Channel enable | По каналу | `PARTIAL` (поля в BotSettings; outbound off) |
| AI provider enable | Провайдер ≠ `NONE` | Default `NONE` = `DONE` |
| Write booking | Только после race-test + API | `NOT DONE` |

Production / write / channel gates **не** повышать из-за закрытия `CONTRACT-MODE-01` / M1.

## Связь с существующим control plane

См. [`../architecture/bot-control-plane-foundation.md`](../architecture/bot-control-plane-foundation.md):
режимы `OFF/TEST/HINTS/DRAFT/AUTO`, kill-switch, readiness matrix.
Этот документ **не отменяет** foundation; он фиксирует экосистемный целевой порядок
и **закрытый** deliberate dual-enum contract с `bot-TV`.
