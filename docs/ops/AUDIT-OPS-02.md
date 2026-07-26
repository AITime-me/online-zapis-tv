# AUDIT-OPS-02 — доказательная проверка ops-контура

## Статус карточки

**Исходная карточка задачи в репозитории ранее отсутствовала.**
Этот файл восстанавливает scope **только** из фактического Git-кода, истории коммитов и ops-артефактов.
Задача **не закрывается** без server evidence.

**Статус аудита на момент создания документа:** `NOT VERIFIED` (сервер в рамках DOCS-01 / этой записи не проверялся).
Репозиторные артефакты сами по себе дают максимум `PARTIAL` готовности реализации, но не доказательство работы на хосте.

## Scope (восстановленный из Git)

Контур:

- PostgreSQL production dump / backup;
- проверка (verification) дампа;
- isolated restore-test;
- Internal Health Monitor (IHM);
- systemd timers/services для backup и health;
- уведомления (Telegram) без секретов/ПДн;
- связанные runbooks в `docs/operations/`.

Ключевые пути в репозитории:

| Артефакт | Назначение |
| --- | --- |
| `scripts/ops/production-backup.sh` | Production dump/backup |
| `scripts/ops/production-restore-database.sh` | Restore path |
| `scripts/ops/internal-health-monitor.sh` | IHM, в т.ч. проверка дампов |
| `scripts/ops/internal-health-monitor-telegram.py` | Алерты IHM |
| `deploy/systemd/**` | Timers/units |
| `docs/operations/**` | Runbooks |

## Commit `d9325a6`

`d9325a629ed78eac7490212d61b509ec205f2a6a` — `fix(ops): retry PostgreSQL dump verification`

- Изменяет логику retry / timeout handling проверки PostgreSQL dump в Internal Health Monitor (`scripts/ops/internal-health-monitor.sh`).
- Это **улучшение кода проверки дампа в Git**, но **не** server evidence успешного свежего dump/verify на хосте.

## Что уже доказано репозиторием

- Есть скрипты backup, restore, IHM.
- Есть systemd unit/timer артефакты под ops.
- Есть operational documentation под backup/restore/monitoring.
- IHM содержит путь проверки дампа; после `d9325a6` — с retry verification.
- Политика fail-closed / ops docs существует рядом с кодом.

Этого **достаточно** чтобы вести аудит, **недостаточно** чтобы ставить `DONE`.

## Что требует проверки на сервере (минимум)

Без выполнения и фиксации evidence на сервере пункты ниже остаются `NOT VERIFIED`:

1. Активность backup timers (`systemctl` / timer last / next).
2. Успешный **свежий** dump (возраст, путь, размер, exit status).
3. Checksum / проверка дампа (включая поведение после retry из `d9325a6`).
4. Изолированный restore-test (не на боевую БД без процедуры).
5. Возраст последнего успешного restore-test.
6. Работа Internal Health Monitor (timer/service, последние прогоны).
7. События `warning` / `critical` / `recovery` (доставка и классификация).
8. Отсутствие повторяющегося alert-spam.
9. Контроль дисков и mount (свободное место, mountpoints backup/automation).
10. Проверка состояния после reboot (timers вернулись, сервисы healthy).
11. Отсутствие секретов и персональных данных в логах/алертах.

## Явно вне scope закрытия без evidence

- Объявить backup/restore/IHM production-ready.
- Считать `d9325a6` доказательством успешной verify на сервере.
- Менять production defaults, Compose, Prisma, функциональный код «заодно» с аудитом.

## Результат аудита (заполняется при server pass)

| Критерий | Статус | Evidence (команда/вывод/дата) |
| --- | --- | --- |
| Backup timers active | NOT VERIFIED | |
| Fresh successful dump | NOT VERIFIED | |
| Dump checksum/verify | NOT VERIFIED | |
| Isolated restore-test | NOT VERIFIED | |
| Restore-test age | NOT VERIFIED | |
| IHM running | NOT VERIFIED | |
| warning/critical/recovery | NOT VERIFIED | |
| No alert spam | NOT VERIFIED | |
| Disks/mounts | NOT VERIFIED | |
| Post-reboot OK | NOT VERIFIED | |
| No secrets/PII in logs | NOT VERIFIED | |

**Итог:** пока таблица не заполнена server evidence → статус задачи `NOT VERIFIED` (или `PARTIAL` после частичного прогона с явным списком пробелов).
