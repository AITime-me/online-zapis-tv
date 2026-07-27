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
| Backup timers active | PARTIAL (server audit 2026-07-26) | Server read-only audit `2026-07-26T11:31:35Z` — timers enabled/active |
| Fresh successful dump | PARTIAL (server audit 2026-07-26) | Prod/staging dumps age ~13h at audit time |
| Dump checksum/verify | PARTIAL (server audit 2026-07-26) | IHM `pg_restore -l` healthy; no separate `.sha256` sidecar |
| Isolated restore-test | NOT VERIFIED | Repo fix 2026-07-27: `--no-owner --no-acl` + bounded pg_restore diagnostic evidence. Server 2026-07-27: production SUCCESS; staging FAIL `PG_RESTORE_FAILED` (role `tvoe_vremya` absent in clean container). **Staging VERIFIED только после повторного серверного прогона с исправленным скриптом.** |
| Restore-test age | NOT VERIFIED | Requires server evidence after controlled re-install + staging re-run |
| IHM running | PARTIAL (server audit 2026-07-26) | Timer active; `INTERNAL_HEALTH_MONITOR OK` |
| warning/critical/recovery | PARTIAL | critical+recovery seen; warning class still NOT VERIFIED |
| No alert spam | PARTIAL (server audit 2026-07-26) | No spam in journal window |
| Disks/mounts | PARTIAL (server audit 2026-07-26) | `/` 47%, inodes 7%, `/srv/automation-data` mounted |
| Post-reboot OK | PARTIAL (server audit 2026-07-26) | Boot 2026-07-24; timers active after boot |
| No secrets/PII in logs | PASS | Log-secret hygiene report 2026-07-26: 16/16 `KEY_NAME_ONLY`, 0 exposure |

**Критерий №18 (секреты в логах):** подтверждён как `PASS` отчётом от `2026-07-26`
(unit `online-zapis-tv-production-backup.service`, 100 строк, 16 keyword-hit, все `KEY_NAME_ONLY`).

**Общий verdict `AUDIT-OPS-02`:** остаётся `PARTIAL`.
Isolated restore-test на сервере **не** верифицирован целиком: production oneshot
`2026-07-27` дал SUCCESS, staging — FAIL из‑за `pg_restore` OWNER/ACL на роль
`tvoe_vremya`, отсутствующую в чистом контейнере. Исправление в Git
(`--no-owner --no-acl` + diagnostic evidence) **не** равно staging VERIFIED.

**Итог:** задача не `DONE`, пока нет повторного server evidence для staging
restore-test (и warning class).

### Корневая причина staging FAIL (2026-07-27)

Isolated restore-test поднимает чистый PostgreSQL и раньше вызывал `pg_restore`
с восстановлением исходных владельцев/ACL. Staging dump содержит ~353 объектов
с `OWNER TO tvoe_vremya`; роли в контейнере нет → `ERROR_CODE=PG_RESTORE_FAILED`,
`ExecMainStatus=30`. Production прошёл, потому что его объекты принадлежат
уже существующей роли `postgres`. Постоянное создание роли `tvoe_vremya` в
контейнере — не решение: тест должен проверять переносимость дампа независимо
от исходных ролей.
