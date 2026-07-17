# Production deploy и rollback приложения

Автоматизированные скрипты безопасного production-deploy с pre-deploy backup, миграциями и откатом **только приложения**. Полностью изолированы от staging.

Связанные документы:

- [Production Docker Compose](./production-compose.md) — compose, env, первый запуск контуров
- [Production backup](./production-backup.md) — ежедневный и ручной backup PostgreSQL
- [Staging deploy](./staging-deploy.md) — отдельный staging-контур (`/opt/online-zapis-tv`)
- [STAGING_PRODUCTION.md](../STAGING_PRODUCTION.md) — bootstrap БД и OWNER (отдельный этап)

> Скрипты **не являются разрешением** на публичный production-запуск. HTTPS reverse proxy, restore БД и bootstrap — следующие этапы. Scheduled backup: [production-backup.md](./production-backup.md).

## Размещение

| Параметр | Production | Staging |
| --- | --- | --- |
| Checkout | `/opt/online-zapis-tv-production` | `/opt/online-zapis-tv` |
| Env | `.env.production` | `.env.staging` |
| Compose | `docker-compose.production.yml` | `docker-compose.staging.yml` |
| App (loopback) | `http://127.0.0.1:3100` | `http://127.0.0.1:3000` |
| Lock | `backups/production/deploy-state/.production-ops.lock` | `backups/deploy-state/.deploy.lock` |
| DB backups | `backups/production/postgres/` | `backups/postgres/` |
| Manifests | `backups/production/deploy-state/` | `backups/deploy-state/` |

Общих lock-файлов, backup-каталогов и manifest между контурами **нет**.

## Пользователь и права

- Запуск от пользователя `deploy` на production-сервере.
- `.env.production` создаётся вручную из `.env.production.example`, **вне Git** (рекомендуется `chmod 600`).
- Каталог `backups/` в `.gitignore`.

## Production guard

Перед любой изменяющей операцией скрипты проверяют:

- checkout — `/opt/online-zapis-tv-production` (не `/opt/online-zapis-tv`);
- существует `.env.production`;
- `APP_ENV=production`;
- `docker-compose.production.yml` и production container names;
- отсутствие staging-имён в compose config;
- Docker daemon и `docker compose config`;
- Git: ветка `main`, чистое дерево, только fast-forward до `origin/main`;
- секреты не выводятся.

## Скрипты

```bash
# План без изменений (на сервере, из production checkout)
bash scripts/ops/production-deploy.sh --dry-run

# Deploy (интерактивно: DEPLOY PRODUCTION)
bash scripts/ops/production-deploy.sh

# Redeploy текущего коммита без git pull
bash scripts/ops/production-deploy.sh --redeploy-current

# Откат только app (интерактивно: ROLLBACK PRODUCTION APP)
bash scripts/ops/production-rollback-app.sh
bash scripts/ops/production-rollback-app.sh --manifest latest --dry-run

# Ручной backup PostgreSQL (см. production-backup.md)
bash scripts/ops/production-backup.sh --dry-run
bash scripts/ops/production-backup.sh
```

## Последовательность deploy

1. Production guard, env validation, compose preflight, git checks.
2. `git fetch origin main` — показ current/target commits.
3. Fast-forward `main` → `origin/main` (или `--redeploy-current` без изменения Git).
4. **Pre-deploy backup** PostgreSQL (`pg_dump -Fc`, atomic verify, `chmod 600`).
5. Tag текущего app image для rollback.
6. Initial deploy manifest.
7. Build app + migrator images.
8. `prisma migrate status` → `migrate deploy` (если pending).
9. Restart **только** production app (postgres и volumes не пересоздаются).
10. Docker health + HTTP `/api/health` (`ok=true`, `status=healthy`).
11. Manifest обновляется после каждого критического этапа.

При ошибке backup или миграций deploy останавливается **до** restart app. Автоматический DB restore **не** выполняется.

## Pre-deploy backup

| Параметр | Значение |
| --- | --- |
| Каталог | `backups/production/postgres/` |
| Формат | `pg_dump -Fc` |
| Имя | `<UTC_TIMESTAMP>_<SHORT_SHA>.dump` |
| Схема | temp file → `pg_restore -l` verify → `chmod 600` → atomic `mv` |
| PostgreSQL | не останавливается |

## Lock

`backups/production/deploy-state/.production-ops.lock` — единый lock для deploy, rollback и backup (`flock -n`). `--dry-run` lock не берёт. Staging lock не используется.

## Manifest

Каталог: `backups/production/deploy-state/`. Права `600`. Symlink `latest` на последний deploy manifest.

Поля (без секретов): `STATE_VERSION`, `TIMESTAMP_UTC`, `ENVIRONMENT=production`, commit SHA, `DEPLOY_MODE`, `BACKUP_PATH`, `BACKUP_STATUS`, `ROLLBACK_IMAGE_TAG`, image IDs, `GIT_STATUS_STAGE`, `BUILD_STATUS`, `MIGRATION_STATUS`, `APP_RESTART_STATUS`, health statuses, `DEPLOY_STATUS`.

Rollback пишет отдельный `*_rollback.env` manifest.

## Rollback приложения

- Откатывает **только** Docker image/container app.
- Git, PostgreSQL, volumes и схема БД **не** меняются.
- Нет `git reset --hard`, удаления файлов, seed или автоматического restore БД.
- Если в deploy manifest `MIGRATION_STATUS=applied` — выводится предупреждение о возможной несовместимости app/схемы.
- При `precheck_failed` / `postcheck_failed` / `failed` миграций — rollback блокируется (fail-closed).

## HTTPS и reverse proxy

Следующий инфраструктурный этап: TLS + reverse proxy на `127.0.0.1:3100`. `AUTH_URL` в `.env.production` должен совпасть с публичным HTTPS-доменом.

## Что не входит в этот этап

- restore database (см. будущий этап);
- создание `.env.production` скриптами;
- bootstrap/seed/OWNER;
- реальный deploy из CI.
