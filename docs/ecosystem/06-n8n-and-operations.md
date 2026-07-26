# 06 — n8n и operations

## Роль n8n

n8n — **фоновый оркестратор** и **не является обязательным звеном** основного потока клиентских сообщений.

Через n8n запрещено передавать телефоны, исходные тексты сообщений, фото, ключи/токены и критические команды изменения расписания
(см. [02-security-and-data-flow.md](./02-security-and-data-flow.md)).

## Обязательный системный workflow: `SYSTEM — Error Handler`

Требования:

1. Первая нода — отдельный **Error Trigger**.
2. Workflow назначается как **Error Workflow** каждому активному рабочему workflow.
3. Один общий Error Handler может обслуживать несколько workflow.
4. Передаются только безопасные технические данные.
5. Retry разрешён только для заранее утверждённых временных ошибок.
6. Число попыток ограничено.
7. Бесконечные циклы запрещены.
8. После исчерпания retry — dead-letter или ручной разбор.
9. Нужны отдельные события `warning`, `critical`, `recovery`.
10. Error Handler контролируется **внешним** мониторингом.
11. n8n **не должен быть единственным сторожем** собственного состояния.
12. Автоматическое исправление клиентских данных, записей и расписания **запрещено**.

## Фактический статус

| Элемент | Статус |
| --- | --- |
| n8n Compose / staging install | `NOT DONE` |
| `SYSTEM — Error Handler` | `NOT DONE` |
| Design Compose/storage/backup/monitoring для n8n | `NOT DONE` → `N8N-DESIGN-01` |
| Диск `/srv/automation-data` на сервере | `NOT VERIFIED` в этой задаче (ранее отмечался в server audit; повторить в ops/server checks) |

## Ops booking-контура (`online-zapis-tv`)

Существующие артефакты (не n8n):

- `scripts/ops/production-backup.sh`
- `scripts/ops/production-restore-database.sh`
- `scripts/ops/internal-health-monitor.sh` (+ telegram notify)
- systemd units в `deploy/systemd/`
- runbooks в `docs/operations/`

Commit `d9325a6 fix(ops): retry PostgreSQL dump verification` улучшил retry проверки дампа в Internal Health Monitor.

Доказательная проверка на сервере — `AUDIT-OPS-02` ([../ops/AUDIT-OPS-02.md](../ops/AUDIT-OPS-02.md)).
Без server evidence статус ops readiness = `PARTIAL` / `NOT VERIFIED`.
