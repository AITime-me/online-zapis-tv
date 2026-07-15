# Автоматизированный staging deploy

Документ описывает безопасные скрипты деплоя, отката приложения и ручного восстановления базы на Ubuntu-сервере. Скрипты рассчитаны на пользователя `deploy` и запуск из корня репозитория (`/opt/online-zapis-tv`).

Реальный deploy, rollback и restore **не выполняются** из CI автоматически на этом этапе — только подготовлена основа для ручного и будущего автоматического запуска.

## Зачем нужна автоматизация

Ручной deploy из 14 шагов легко пропустить проверку, перепутать порядок операций или случайно вывести секрет. Скрипт `scripts/ops/staging-deploy.sh` фиксирует проверенную последовательность:

1. Проверки Git и env.
2. Backup PostgreSQL **до** миграций.
3. Сборка образов app и migrator.
4. Prisma migrate через отдельный ops-сервис.
5. Перезапуск **только** app.
6. Health-check с таймаутом.
7. Сохранение state manifest для отката app.

## Что проверяется до начала

- Наличие `git`, `docker`, `flock`, `curl` и доступность Docker daemon.
- Файл `.env.staging` существует, принадлежит текущему пользователю, права не дают чтения group/others (рекомендуется `600`).
- Обязательные переменные env проверяются **по имени и политике**, значения не выводятся.
- `APP_ENV` должен быть ровно `staging`.
- `TRUST_PROXY_HEADERS` не должен быть `true` (reverse proxy ещё не настроен).
- `AUTH_SECRET` и `SCHEDULE_VIEW_TOKEN` — минимум 32 символа.
- `AUTH_URL` соответствует staging-политике (HTTPS или HTTP только для loopback).
- Почтовые переменные проверяются, если `MAIL_PROVIDER` не `disabled`.
- Каталог `backups/` исключён из Git.
- Git working tree чистое, ветка `main`, возможен только fast-forward до `origin/main`.

## Чистый Git

Deploy разрешён только с ветки `main` без локальных изменений. Это гарантирует, что на сервере выполняется ровно то, что есть в `origin/main`, без «забытых» правок на диске. Скрипт не использует `git reset --hard`, `git clean` или force-операции.

## Блокировка deploy (flock)

Файл `backups/deploy-state/.deploy.lock` используется только как lock-дескриптор. Он **не содержит секретов**. Второй одновременный deploy завершится с понятным сообщением. Lock снимается автоматически при завершении или ошибке процесса.

## `.env.staging`

Файл хранится **вне Git** на сервере. Скрипты **не** выполняют `source .env.staging` и **не** выводят его содержимое. Переменные читаются построчно через безопасный parser (`ops_read_env_value`).

Рекомендуемые права: `600`, владелец — `deploy`.

## Backups PostgreSQL

| Параметр | Значение |
| --- | --- |
| Каталог | `backups/postgres/` |
| Формат | `pg_dump -Fc` (custom) |
| Имя | `<UTC_TIMESTAMP>_<SHORT_SHA>.dump` |
| Права файла | `600` |
| Проверка | `pg_restore -l` внутри контейнера Postgres |

Backup создаётся **до** `prisma migrate deploy`. Существующий файл с тем же именем не перезаписывается. Каталог `backups/` не коммитится.

## State manifest

| Параметр | Значение |
| --- | --- |
| Каталог | `backups/deploy-state/` |
| Имя | `<UTC_TIMESTAMP>_<TARGET_SHORT_SHA>.env` |
| Права | `600` |
| Указатель | `backups/deploy-state/latest` → symlink на последний manifest |

Manifest содержит только несекретные поля: commit SHA, пути backup, image ID, rollback tag, статусы migration/deploy/health. **Не** хранит пароли, `DATABASE_URL`, cookies или токены. Читается через `ops_read_manifest_value`, не через `source`.

При неуспешном deploy manifest всё равно сохраняется с кодом ошибки.

## Migrator (Docker target + Compose)

Вместо полного `builder`-образа используется минимальный target `migrator`:

- Node + `npm ci` зависимости из стадии `deps` (включая локальный `tsx` и Prisma CLI).
- `prisma/` (schema + migrations).
- Runtime-файлы классификатора `prisma-migrate-status.ts` и `classify-migrate-status-cli.ts`.
- Локальные бинарники `/app/node_modules/.bin/prisma` и `/app/node_modules/.bin/tsx` — **без** host `npx`/`npm`/`node` на Ubuntu.
- Без `prisma generate`, без исходников приложения, без `.env*` и секретов в image.

Compose-сервис `migrator`:

- profile `ops` — не стартует при обычном `docker compose up`.
- `entrypoint: ["/app/node_modules/.bin/prisma"]` — Prisma CLI из image, без автозагрузки пакетов через `npx`.
- `DATABASE_URL` собирается из `POSTGRES_*` через Compose environment (не в image).
- Только сеть `staging_internal`, без published ports.
- `depends_on: postgres (healthy)`.
- `prisma migrate status` и классификатор выполняются внутри одноразового контейнера; вывод status передаётся классификатору через **stdin**.

На Ubuntu-хосте для deploy/rollback/restore **не** требуются `node`, `npm` или `npx`.

## Запуск

### Dry-run (без изменений)

```bash
cd /opt/online-zapis-tv
bash scripts/ops/staging-deploy.sh --dry-run
```

Выполняются только безопасные проверки и вывод плана. Не выполняются: `git pull`, backup, сборка, миграции, перезапуск, запись manifest.

### Dry-run redeploy-current

```bash
bash scripts/ops/staging-deploy.sh --dry-run --redeploy-current
```

Проверяет Git (HEAD == origin/main), env, Compose, определяет текущий container image id и показывает план повторного развёртывания без изменений Docker/Git/backup.

## Повторное развёртывание текущего commit (`--redeploy-current`)

### Почему обычный deploy отказывается без новых commits

Deploy по умолчанию делает **fast-forward** `main` → `origin/main` и разворачивает **новые** commits. Если `HEAD` уже равен `origin/main`, обычный deploy — no-op: он намеренно завершается с ошибкой, чтобы не запускать backup, migrations и пересборку без явного намерения.

**Не создавайте пустой commit** только ради запуска deploy — это засоряет историю Git.

### Когда нужен `--redeploy-current`

- код уже вручную подтянут (`git pull --ff-only`), но app-контейнер ещё на старом image;
- предыдущий deploy прервался до сборки или перезапуска app;
- нужно пересобрать и развернуть **тот же** commit без изменения Git.

Это **не** force deploy: все проверки env, backup, migrations, rollback tag, health-check и подтверждение `DEPLOY` сохраняются. Git не меняется (`git merge` не вызывается).

### Пример dry-run

```bash
cd /opt/online-zapis-tv
bash scripts/ops/staging-deploy.sh --dry-run --redeploy-current
```

### Пример интерактивного redeploy

```bash
cd /opt/online-zapis-tv
bash scripts/ops/staging-deploy.sh --redeploy-current
```

Скрипт покажет current/target SHA (одинаковые), текущий container image id (в том числе legacy reference вроде `online-zapis-tv-app`), compose image ref и попросит ввести `DEPLOY`.

`--redeploy-current` **нельзя** использовать, если на `origin/main` есть commits, которых нет локально — в этом случае нужен обычный deploy.

### Обычный deploy

```bash
cd /opt/online-zapis-tv
bash scripts/ops/staging-deploy.sh
```

Перед изменениями скрипт показывает:

- текущий и целевой short SHA;
- список commit messages между ними;
- план шагов.

Требуется ввести **точно** `DEPLOY` (case-sensitive). Пустой ввод или другой текст — отказ.

### Автоматизация (--yes)

```bash
bash scripts/ops/staging-deploy.sh --yes
```

Пропускает интерактивное подтверждение, но **не** отключает backup, health-check и fail-closed проверки. Предназначено для будущего CI.

## Миграции

1. Postgres healthy.
2. Сборка migrator image (до любого `migrate status`).
3. `migrator migrate status` внутри контейнера — pre-deploy проверка.
4. Классификатор внутри того же migrator image (stdin, локальный `tsx`) — `up_to_date` / `pending` / `error:*`.
5. При `pending` — `migrator migrate deploy`; при connection/failed/diverged/unknown — deploy останавливается.
6. Повторный `migrate status` + классификация; post-deploy принимает только `up_to_date`.

`MIGRATION_STATUS` в manifest и итоговом summary:

- `up_to_date` — pending migrations не было, `migrate deploy` не запускался;
- `applied` — были pending migrations и `migrate deploy` успешно выполнен;
- `dry_run_skipped` — dry-run без миграций;
- `precheck_failed`, `postcheck_failed`, `failed` — ошибки проверки или deploy migrations.

Запрещено в deploy-скрипте: `migrate reset`, `db push`, `migrate dev`, ручное удаление `_prisma_migrations`.

### При ошибке migration

- App **не** перезапускается.
- Предыдущий app-контейнер продолжает работать.
- Backup сохраняется.
- Manifest записывается со статусом `failed_migration`.
- Автоматический DB restore **не** выполняется.

## Health-check после deploy

1. Ожидание Docker health контейнера app (таймаут ~180 с, интервал 5 с).
2. HTTP `GET http://127.0.0.1:3000/api/health` — ожидается `200`, timeout curl 10 с.
3. Без cookies, credentials и следования произвольным redirect.

При ошибке выводятся только последние ~15 строк логов app (без гарантии полной санитизации — не копируйте логи в публичные каналы).

## Failed health-check и автоматический app rollback

Если migration прошла, но новый app не стал healthy:

1. DB **не** откатывается автоматически.
2. Backup и новый image **не** удаляются.
3. App возвращается на образ с сохранённым rollback tag.
4. Перезапускается **только** app.
5. Повторный Docker + HTTP health-check.
6. Manifest обновляется (`APP_ROLLBACK_STATUS`).
7. Скрипт завершается с ненулевым кодом даже если старый app снова healthy.

**Важно:** откат app ≠ откат схемы БД. После неудачного deploy с успешной migration схема может не соответствовать коду старого app — может потребоваться ручной `staging-restore-db.sh`.

## Ручной app rollback

```bash
bash scripts/ops/staging-rollback-app.sh
# или с конкретным manifest:
bash scripts/ops/staging-rollback-app.sh --manifest backups/deploy-state/20260714T120000_bd2c3c0.env
```

- Читает `latest` или указанный manifest (только внутри `backups/deploy-state/`).
- Показывает previous/target commit, rollback tag, текущий image.
- Требует ввод **точно** `ROLLBACK`.
- Не меняет Git и БД.
- Dry-run: `--dry-run`.

## Ручной DB restore

```bash
bash scripts/ops/staging-restore-db.sh --backup backups/postgres/20260714T120000_bd2c3c0.dump
```

**Никогда** не вызывается deploy-скриптом автоматически.

### Защиты

- Backup обязателен, только внутри `backups/postgres/`.
- Запрещены symlinks, `/tmp`, path traversal, чтение group/others.
- Проверка `pg_restore -l`.
- Подтверждение: точная фраза `RESTORE STAGING DATABASE`.
- Перед restore создаётся **pre-restore backup** с той же процедурой валидации.

### Безопасная процедура restore

Чтобы не получить частично восстановленную базу, скрипт:

1. Останавливает **только** app (`compose stop app`).
2. В контейнере Postgres завершает подключения к целевой БД.
3. `DROP DATABASE` + `CREATE DATABASE` (пустая база).
4. `pg_restore` в пустую базу.
5. Запускает app и проверяет health.

PostgreSQL volume, сеть и контейнер Postgres **не** удаляются. `docker compose down` **не** используется.

### При ошибке restore

Скрипт завершается fail-closed. Pre-restore backup и исходный backup сохраняются. Manifest restore записывается в `backups/deploy-state/`.

## Проверка приложения через SSH-туннель

На локальной машине:

```bash
ssh -L 3000:127.0.0.1:3000 deploy@your-staging-host
curl http://127.0.0.1:3000/api/health
```

Ожидается JSON с `"ok": true` и `"database": "connected"`.

## Интерпретация manifest

| Поле | Значение |
| --- | --- |
| `STATE_VERSION` | Версия формата manifest |
| `DEPLOY_MODE` | `fast_forward` или `redeploy_current` |
| `PREVIOUS_COMMIT_SHA` | Commit до deploy |
| `TARGET_COMMIT_SHA` | Commit после fast-forward |
| `BACKUP_PATH` | Путь к PostgreSQL dump |
| `ROLLBACK_IMAGE_TAG` | Docker tag для отката app |
| `MIGRATION_STATUS` | `up_to_date`, `applied`, `dry_run_skipped`, `precheck_failed`, `postcheck_failed`, `failed` |
| `DEPLOY_STATUS` | `success`, `failed_migration`, `failed_health` |
| `APP_ROLLBACK_STATUS` | Результат автоматического отката app |
| `DOCKER_HEALTH_STATUS` / `HTTP_HEALTH_STATUS` | Результаты проверок |

## Категорически запрещённые действия в ops-скриптах

- `docker compose down` (удаление стека).
- `docker system prune` / `docker image prune`.
- Удаление Docker volumes.
- `git reset --hard`, `git clean -fd`.
- `prisma migrate reset`, `db push`, `migrate dev`.
- Вывод или `source` `.env.staging`.
- Автоматический DB restore при failed deploy.
- Включение `TRUST_PROXY_HEADERS=true` без reverse proxy.

## Ограничения до полноценного CI/CD

- Deploy по-прежнему запускается вручную (или через `--yes` без GitHub Actions).
- Старые backups и rollback tags **не** удаляются автоматически.
- Production deploy не входит в эту задачу.
- Нет внешнего secret store — секреты только в `.env.staging` на сервере.
- Ops CLI (owner reset, mail:test) по-прежнему может использовать `builder`-образ — отдельно от migrator.

## Связанные файлы

| Файл | Назначение |
| --- | --- |
| `scripts/ops/staging-deploy.sh` | Основной deploy |
| `scripts/ops/staging-rollback-app.sh` | Откат app |
| `scripts/ops/staging-restore-db.sh` | Ручной restore БД |
| `scripts/ops/lib/staging-ops-common.sh` | Общие безопасные функции |
| `docker-compose.staging.yml` | Сервисы app, postgres, migrator (profile ops) |
| `Dockerfile` | Targets: deps, builder, **migrator**, runner |

## Проверка безопасности

```bash
npm run test:security:staging-ops
```

Тест анализирует исполняемый код скриптов (не только комментарии), порядок операций и compose-конфигурацию.
