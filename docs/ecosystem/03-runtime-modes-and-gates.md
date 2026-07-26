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

Synthetic / закрытая тестовая поверхность может быть **отдельным exposure gate**, а не обязательно отдельным значением runtime enum.

Каждый переход требует **отдельного подтверждения OWNER**.
Завершение разработки **ничего автоматически не включает**.

## Существующее расхождение enum (не закрыто кодом)

| Контур | Enum в коде | Источник |
| --- | --- | --- |
| `bot-TV` | `OFF \| HINTS \| DRAFT \| AUTO_READ \| AUTO_WRITE` | Bot Core settings |
| `online-zapis-tv` control plane | `OFF \| TEST \| HINTS \| DRAFT \| AUTO` | тип `BotMode` в `src/lib/bot-settings/defaults.ts`; foundation docs |

**Не выбираем молча новый единый enum и не меняем код в рамках DOCS-01.**
Согласование — задача backlog `CONTRACT-MODE-01`.

Интерпретация до согласования:

- `TEST` в control plane ≈ закрытый/синтетический exposure gate;
- `AUTO` в control plane **не равен** безопасному `AUTO_WRITE` без явного write-scope;
- целевая семантика write — только через `AUTO_WRITE: booking` после production gate.

## Gates (канон)

| Gate | Назначение | Статус |
| --- | --- | --- |
| Runtime mode | Ограничение поведения бота | `PARTIAL` (два enum) |
| Exposure / synthetic / closed test | До публичных каналов | `NOT DONE` / `PARTIAL` в bot-TV baseline |
| Production gate | Перед write | `NOT DONE` как отдельный enforced gate |
| Channel enable | По каналу | `PARTIAL` (поля в BotSettings; outbound off) |
| AI provider enable | Провайдер ≠ `NONE` | Default `NONE` = `DONE` |
| Write booking | Только после race-test + API | `NOT DONE` |

## Связь с существующим control plane

См. [`../architecture/bot-control-plane-foundation.md`](../architecture/bot-control-plane-foundation.md):
режимы `OFF/TEST/HINTS/DRAFT/AUTO`, kill-switch, readiness matrix.
Этот документ **не отменяет** foundation; он фиксирует экосистемный целевой порядок и расхождение с `bot-TV`.
