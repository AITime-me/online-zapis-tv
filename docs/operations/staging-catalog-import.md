# Staging: импорт каталога услуг

Безопасный перенос канонического каталога на staging через одноразовый Docker ops-образ (`Dockerfile` target `builder`).

## Канонический источник

- Файл: `scripts/data/import-services-data.ts`
- Содержимое: 11 категорий, 88 услуг, 5 канонических мастеров, 88 связей в файле
- Импортёр: `scripts/import-services.ts` (+ ядро `scripts/lib/catalog-service-import.ts`)

## Канонические мастера (создать вручную до apply)

Импорт **не создаёт** мастеров. В `/admin/masters` должны быть ровно эти активные карточки (имена — полный канон или безопасные алиасы из `MASTER_ALIASES`):

1. Ксения Вайзер  
2. Татьяна Федулова  
3. Ирина Пашкова  
4. Ирина Белизина  
5. Елена Правич  

Замечания:

- карточку «Ирина» (без фамилии) импорт сопоставит только с Ириной Пашковой;
- тестовую Юлию не удалять до завершения проверки роли `MASTER`; она не является каноническим мастером и импортом не трогается;
- не запускать `npm run db:seed` / production seed для наполнения каталога.

## Защита записи

| Режим | Условие |
|-------|---------|
| Dry-run (по умолчанию) | Разрешён; БД не изменяет |
| `--apply` | Только `APP_ENV=staging` **и** `--confirm-staging` |
| `APP_ENV=production` | Apply всегда запрещён |
| `APP_ENV` отсутствует / неизвестен | Apply запрещён |
| `--disable-stale-bindings` | Только вместе с `--apply --confirm-staging` и `APP_ENV=staging` |

Нет флага `--force-production`.

## Перед apply

1. Backup staging PostgreSQL (существующий ops backup).  
2. Проверить пять мастеров в админке.  
3. Dry-run и прочитать отчёт.  
4. Явно подтвердить apply.

## Запуск через Docker (ops / builder)

На Ubuntu staging нет host Node. Используйте образ `--target builder` (есть Node, `tsx`, Prisma Client, `scripts/`).

Не используйте `docker run --env-file .env.staging` целиком. Не публикуйте порт БД. Не запускайте seed, migrate deploy/reset, `db push`, restart app/postgres из этого сценария.

`DATABASE_URL` и `APP_ENV` извлекаются из уже запущенного контейнера `tvoe-vremya-staging-app` и передаются **только по имени** (`--env ИМЯ`). Значения не печатаются.

### 1) Staging dry-run

```bash
(
  set -euo pipefail
  trap 'unset DATABASE_URL APP_ENV NET' EXIT
  cd /opt/online-zapis-tv
  docker build --target builder -t online-zapis-tv-ops:local .
  DATABASE_URL="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' tvoe-vremya-staging-app | sed -n 's/^DATABASE_URL=//p')"
  APP_ENV="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' tvoe-vremya-staging-app | sed -n 's/^APP_ENV=//p')"
  test -n "$DATABASE_URL"
  test "$APP_ENV" = "staging"
  NET="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' tvoe-vremya-staging-app | grep 'staging_internal$')"
  test "$(printf '%s\n' "$NET" | grep -c .)" -eq 1
  export DATABASE_URL APP_ENV
  docker run --rm --env DATABASE_URL --env APP_ENV --network "$NET" \
    online-zapis-tv-ops:local \
    npm run import:services
)
```

### 2) Staging apply

```bash
(
  set -euo pipefail
  trap 'unset DATABASE_URL APP_ENV NET' EXIT
  cd /opt/online-zapis-tv
  docker build --target builder -t online-zapis-tv-ops:local .
  DATABASE_URL="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' tvoe-vremya-staging-app | sed -n 's/^DATABASE_URL=//p')"
  APP_ENV="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' tvoe-vremya-staging-app | sed -n 's/^APP_ENV=//p')"
  test -n "$DATABASE_URL"
  test "$APP_ENV" = "staging"
  NET="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' tvoe-vremya-staging-app | grep 'staging_internal$')"
  test "$(printf '%s\n' "$NET" | grep -c .)" -eq 1
  export DATABASE_URL APP_ENV
  docker run --rm --env DATABASE_URL --env APP_ENV --network "$NET" \
    online-zapis-tv-ops:local \
    npm run import:services -- --apply --confirm-staging
)
```

Опционально отключение чужих (неканонических) активных связей после явного решения:

```bash
npm run import:services -- --apply --confirm-staging --disable-stale-bindings
```

(внутри того же `docker run`…; по умолчанию stale bindings только в отчёте).

`DATABASE_URL` в staging Compose собирается из `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` на хост `postgres`. В ops-сценарии берётся уже собранное значение из контейнера `app`, без печати секретов.

## После apply

1. Повторный dry-run — ожидаются нулевые create и отсутствие конфликтов.  
2. UI: `/admin/services`, `/admin/masters`, публичный `/booking`, `/schedule`.  
3. При проблеме — откат через PostgreSQL backup (не truncate / не `migrate reset` / не `db push`).

## Запреты

- seed каталога на staging/production;  
- production apply;  
- автоудаление услуг, категорий, мастеров;  
- удаление тестовой Юлии до конца проверки MASTER;  
- вывод `DATABASE_URL`, паролей и содержимого `.env.staging` в логах/чатах.
