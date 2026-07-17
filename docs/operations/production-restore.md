# Восстановление production PostgreSQL

Ручное восстановление production-базы из custom-format dump. **Не вызывается** автоматически из deploy, rollback app или backup timer.

Связанные документы:

- [Production backup](./production-backup.md) — создание dump
- [Production deploy](./production-deploy.md) — deploy не восстанавливает БД
- [Production bootstrap](./production-bootstrap.md) — канонические рабочие данные после migrate/seed
- [STAGING_PRODUCTION.md](../STAGING_PRODUCTION.md) — foundation seed и OWNER (отдельный этап)

## Принцип

Restore — **отдельная деструктивная операция** с двухфазной схемой:

1. Восстановление dump во **временную** БД внутри production PostgreSQL.
2. Проверка временной БД.
3. Остановка **только** production app.
4. Переименование: текущая production DB → rollback-safe имя; временная → штатное production имя.
5. Запуск app и health-check.

Приложение **не работает** во время переключения имён БД.

## Требования

- Checkout: `/opt/online-zapis-tv-production`
- `.env.production` с `APP_ENV=production`
- Контейнер `tvoe-vremya-production-postgres` healthy
- Явный путь к `.dump` в `backups/production/postgres/` (без «latest»)

## Dry-run

```bash
cd /opt/online-zapis-tv-production
bash scripts/ops/production-restore-database.sh \
  --dry-run \
  --backup backups/production/postgres/YYYYMMDDTHHMMSSZ_<sha>.dump
```

Проверяет: production guard, путь backup, `pg_restore -l`, план операции. **Без** lock, изменений БД и Docker (кроме read-only verify dump в `/tmp` контейнера).

## Реальный restore

```bash
bash scripts/ops/production-restore-database.sh \
  --apply \
  --backup backups/production/postgres/YYYYMMDDTHHMMSSZ_<sha>.dump
```

Интерактивное подтверждение (точная фраза):

```
RESTORE PRODUCTION DATABASE
```

Требуются **оба** флага: `--apply` и `--backup`.

## Pre-restore backup

Перед переключением БД создаётся страховочный dump текущей production-базы:

- каталог: `backups/production/postgres/`
- имя содержит `prerestore`
- схема: tmp → verify → chmod 600 → atomic mv

Если pre-restore backup не создан или не проверен — restore **запрещён**.

Retention во время restore **не** вызывается.

## Lock

Общий `backups/production/deploy-state/.production-ops.lock` (как deploy/backup). Dry-run lock не берёт.

## Проверка исходного dump

- Только файлы `*.dump` внутри `backups/production/postgres/`
- Resolve абсолютного пути, запрет symlink и `../`
- Безопасный паттерн имени
- `pg_restore -l` до любых изменений БД

## Health после restore

- Docker health контейнера app
- HTTP `http://127.0.0.1:3100/api/health` (`ok=true`, `status=healthy`)

## Ошибки и откат

| Этап | Поведение |
|---|---|
| До переключения БД | Удаляется только временная БД; production DB и app без изменений |
| После переключения, health fail | App останавливается; restored DB переименовывается в `tv_restore_fail_*`; исходная DB возвращается из `tv_restore_rb_*`; app стартует снова |
| Успех | Rollback DB (`tv_restore_rb_*`) **сохраняется** для ручного аудита |

Не выполняется автоматически: migrate deploy, Git rollback, смена app image, удаление rollback DB.

## Ручной возврат rollback DB

Если после успешного restore нужно вернуть **предыдущую** production DB (откат на уровне PostgreSQL):

1. Остановить app: `docker compose ... stop app`
2. Переименовать текущую production DB во временное имя
3. Переименовать `tv_restore_rb_*` обратно в штатное имя production DB
4. Запустить app и проверить health

Это **ручная** операция DBA — отдельный скрипт не входит в этот этап.

## Удаление сохранённой rollback DB

После отдельного подтверждения и проверки, что новая БД стабильна:

```bash
docker exec -e PGPASSWORD=... tvoe-vremya-production-postgres \
  psql -U postgres -d postgres -c 'DROP DATABASE IF EXISTS "tv_restore_rb_..." WITH (FORCE);'
```

Имя берите из restore manifest (`ROLLBACK_DB_NAME`). Не удаляйте pre-restore dump без отдельного решения.

## Manifest

Каталог: `backups/production/deploy-state/*_restore.env`

Поля (без секретов): `SOURCE_BACKUP_PATH`, `PRE_RESTORE_BACKUP_PATH`, `TEMP_DB_NAME`, `ROLLBACK_DB_NAME`, стадии `VERIFY_STATUS`, `TEMP_RESTORE_STATUS`, `SWITCH_STATUS`, health statuses, `RESTORE_STATUS`, `COMMIT_SHA`.

## Проверка безопасности

```bash
npm run test:security:production-restore
```
