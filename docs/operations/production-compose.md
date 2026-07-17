# Production Docker Compose

Минимальный production-контур приложения и PostgreSQL. **Полностью изолирован** от staging.

Общий порядок bootstrap БД и первого входа: [`docs/STAGING_PRODUCTION.md`](../STAGING_PRODUCTION.md).  
Канонические рабочие данные (мастера, каталог, gifts, витрина): [`production-bootstrap.md`](./production-bootstrap.md).  
Staging automation: [`staging-deploy.md`](./staging-deploy.md).  
**Production deploy/rollback:** [`production-deploy.md`](./production-deploy.md).

> Этот compose **не является разрешением** на публичный production-запуск. Перед открытием домена нужны: HTTPS reverse proxy, ops backup/deploy, чистая БД, OWNER, каталог услуг.

## Изоляция от staging

| Ресурс | Staging | Production |
|---|---|---|
| Compose file | `docker-compose.staging.yml` | `docker-compose.production.yml` |
| Project name | (default / staging) | `tvoe-vremya-production` |
| App container | `tvoe-vremya-staging-app` | `tvoe-vremya-production-app` |
| Postgres container | `tvoe-vremya-staging-postgres` | `tvoe-vremya-production-postgres` |
| Network | `staging_internal` | `production_internal` |
| Postgres volume | `postgres_staging_data` | `postgres_production_data` |
| Export volume | `emergency_exports` | `emergency_exports_production` |
| Env file | `.env.staging` | `.env.production` |
| Host app port | `127.0.0.1:3000` | `127.0.0.1:3100` |

Общих volumes, сетей и env-файлов между контурами **нет**.

## Подготовка env

```bash
cp .env.production.example .env.production
# Отредактируйте .env.production на сервере — файл не коммитится.
```

Обязательно задайте уникальные `POSTGRES_PASSWORD`, `AUTH_SECRET` (≥32 символов), `SCHEDULE_VIEW_TOKEN`, `AUTH_URL=https://ваш-будущий-домен`.

`AUTH_URL` должен совпасть с публичным HTTPS-доменом после подключения reverse proxy.

## Запуск (без автоматического seed и OWNER)

```bash
# 1. PostgreSQL
docker compose -f docker-compose.production.yml --env-file .env.production up -d postgres

# 2. Миграции (только явная команда, profile ops)
docker compose -f docker-compose.production.yml --env-file .env.production --profile ops run --rm migrator migrate deploy

# 3. Приложение
docker compose -f docker-compose.production.yml --env-file .env.production up -d app
```

Seed, OWNER, каталог услуг и игровой bootstrap — **отдельные этапы** (см. `STAGING_PRODUCTION.md`, [`production-bootstrap.md`](./production-bootstrap.md)).

## Доступ с хоста

- **App:** `http://127.0.0.1:3100` (только loopback)
- **Health:** `http://127.0.0.1:3100/api/health`
- **PostgreSQL:** не опубликован на хост (только внутри `production_internal`)

## HTTPS и reverse proxy

Домен: **tvoio-vremya.ru**. Подготовка в репозитории и runbook:

→ [`production-https.md`](./production-https.md)

Кратко:

1. Caddy (systemd на хосте) → `http://127.0.0.1:3100`.
2. `AUTH_URL=https://tvoio-vremya.ru` в `.env.production`.
3. `TRUST_PROXY_HEADERS=true`.

Compose **не** включает reverse proxy. Staging `:3000` снаружи не публикуется.

## Что не входит в этот этап

- scheduled backup / restore БД (см. [`production-backup.md`](./production-backup.md), [`production-deploy.md`](./production-deploy.md));
- установка пакета Caddy / переключение DNS (см. [`production-https.md`](./production-https.md));
- автоматический seed;
- автоматическое создание OWNER;
- включение игры, бота или VK-рассылок.
