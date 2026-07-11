# Staging и Production — безопасный порядок запуска

Документ описывает подготовку **новой чистой PostgreSQL-базы** для staging/production.
Локальная dev-база **не переносится** и **не очищается**.

## Критические правила

- **Никогда** не запускайте `prisma/seed.ts` (`npm run db:seed`) в production — скрипт защищён и завершится с ошибкой при `NODE_ENV=production` или `APP_ENV/DEPLOY_ENV=production`.
- **Не переносите** локальную dev-базу на production-сервер.
- **Не используйте** тестовые пароли (`password123`) и email `@example.local`.
- Production seed **не создаёт OWNER** — первого владельца создайте отдельно через `npm run owner:create`.
- После production seed **игра выключена** (`GameConfig.isActive=false`, `GameCatalog` — `DISABLED`).
- Перед deploy подготовьте **backup** и **rollback-план**.

## Порядок развёртывания

### 1. Создать env-файл вне Git

```bash
cp .env.production.example .env.staging
# Отредактируйте: AUTH_SECRET (≥32 символов), AUTH_URL (HTTPS), SCHEDULE_VIEW_TOKEN, пароли Postgres
```

Файл `.env.staging` / `.env.production` **не коммитится**.

Рекомендуемый секрет сессии: **`AUTH_SECRET`** (не `NEXTAUTH_SECRET`).

### 2. Поднять чистую PostgreSQL

Локальная staging-проверка:

```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d postgres
```

Или managed PostgreSQL 17 на хостинге — отдельная пустая база.

### 3. Применить миграции

```bash
npx prisma migrate deploy
```

Только против **новой** production/staging базы, не против локальной dev.

### 4. Production seed

```bash
# Сначала dry-run (без записи):
npm run db:seed:production -- --dry-run

# Затем реальный запуск (только на чистой БД после migrate deploy):
npm run db:seed:production
```

Production seed создаёт только:

- `StudioSettings` (singleton `default`) — create-if-missing
- `BotSettings` (singleton `default`, бот выключен) — create-if-missing
- Юридические документы — create-if-missing (без перезаписи правок)
- `GameConfig` (`default`, `isActive=false`) — create-if-missing
- `GameCatalog` (`procedure-gift`, `DISABLED`) — create-if-missing

**Проверьте** реквизиты студии и юридические тексты после первого входа OWNER.

### 5. Создать первого OWNER

```bash
npm run owner:create
```

Интерактивно: email, имя, пароль (скрытый ввод, ≥12 символов, дважды, подтверждение).
Пароль **не** передаётся аргументом и **не** сохраняется в `.env`.

Dry-run:

```bash
npm run owner:create -- --dry-run --email owner@your-domain.ru --name "Имя владельца"
```

### 6. Запустить приложение

Docker staging (app + postgres):

```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d
```

Или standalone Node после `npm run build && npm run start`.

### 7. Проверить health

```bash
curl http://127.0.0.1:3000/api/health
```

Ожидается `"ok": true`, `"database": "connected"`.

### 8. Войти OWNER и проверить настройки

- `/login` — вход созданным OWNER
- `/admin/settings` — реквизиты студии, контакты, сообщения
- Юридические документы — privacy, terms, consent, offer, cookies

### 9. Создать MANAGER / MASTER через админку

Не через seed. Роли создаются владельцем в `/admin/users`.

### 10. Импортировать реальный каталог услуг

Отдельно, после подтверждения данных:

```bash
npm run import:services          # dry-run
npm run import:services:apply      # запись в БД
```

## Docker-образ

```bash
docker build -t online-zapis-tv:staging .
```

Multi-stage build, `output: "standalone"`, Prisma Client на build-этапе, runtime не от root.

Persistent volumes в staging compose:

- PostgreSQL data
- `exports/emergency` — аварийные XLSX

## Акции на главной

Карусель управляется через админку (`showOnHomepage`, активность, период, приоритет).
Статическая акция «холодная плазма −30%» **не** добавляется автоматически.

## Rollback

1. Остановить приложение
2. Восстановить PostgreSQL из backup
3. Откатить Docker-образ на предыдущий tag
4. Проверить `/api/health`

## Локальная разработка

Dev-процесс **не изменился**:

```bash
docker compose up -d          # только Postgres (docker-compose.yml)
npx prisma migrate dev
npm run db:seed               # dev-only seed
npm run dev
```
