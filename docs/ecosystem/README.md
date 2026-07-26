# Экосистема «Твоё время» — каноническая документация

Этот каталог — **source-of-truth** для границ системы, режимов запуска, Internal Bot API,
Bot Core, n8n, интеграций и production readiness.

Статусы в документах и backlog:

| Статус | Значение |
| --- | --- |
| `DONE` | Подтверждено кодом/артефактами в Git |
| `PARTIAL` | Частично реализовано или есть артефакты без полной готовности |
| `NOT DONE` | Не реализовано |
| `NOT VERIFIED` | Требует проверки вне Git (обычно на сервере) |

## Документы

| Файл | Тема |
| --- | --- |
| [01-system-boundaries.md](./01-system-boundaries.md) | Владение данными и границы сервисов |
| [02-security-and-data-flow.md](./02-security-and-data-flow.md) | Потоки данных и запреты на секреты/ПДн |
| [03-runtime-modes-and-gates.md](./03-runtime-modes-and-gates.md) | Режимы, gates, OWNER-подтверждения |
| [04-internal-bot-api.md](./04-internal-bot-api.md) | Internal Bot API и S2S |
| [05-bot-core-and-knowledge.md](./05-bot-core-and-knowledge.md) | Bot Core и база знаний |
| [06-n8n-and-operations.md](./06-n8n-and-operations.md) | n8n, Error Handler, ops |
| [07-integrations-and-rollout.md](./07-integrations-and-rollout.md) | Порядок каналов и rollout |
| [08-production-readiness.md](./08-production-readiness.md) | Критерии production |
| [BACKLOG.md](./BACKLOG.md) | Единый backlog |
| [../ops/AUDIT-OPS-02.md](../ops/AUDIT-OPS-02.md) | Ops-аудит backup/restore/monitor |

## Связанные существующие документы

- Control plane foundation: [`../architecture/bot-control-plane-foundation.md`](../architecture/bot-control-plane-foundation.md)
- Booking notifications (не AI Bot Core): [`../architecture/bot-booking-notifications.md`](../architecture/bot-booking-notifications.md)
- Ops: [`../operations/`](../operations/)

## Репозитории

| Репозиторий | Роль |
| --- | --- |
| `online-zapis-tv` | Booking Service + control plane `/admin/bot` |
| `bot-TV` | Отдельный Bot Core runtime (fail-closed baseline) |

Документы экосистемы живут в `online-zapis-tv`, чтобы ops и booking-контракты оставались рядом с каноническим сервисом записи.
