# Онлайн-запись «Твоё время»

MVP модуля онлайн-записи для студии красоты «Твоё время» (Курган).

## Стек

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS
- PostgreSQL 17 (Docker локально; позже Timeweb PostgreSQL 17)
- Prisma ORM

## Требования

- Node.js 20+
- Docker и Docker Compose
- npm

## Локальный запуск

### 1. Установить зависимости

```bash
npm install
```

### 2. Настроить переменные окружения

```bash
cp .env.example .env
```

> Prisma CLI читает `.env`. Next.js также подхватывает `.env` и `.env.local`.

Основные переменные:

- `DATABASE_URL` — строка подключения к PostgreSQL
- `APP_TIMEZONE=Asia/Yekaterinburg` — часовой пояс студии (UTC+5)
- `EXPORT_STORAGE=local` — локальное хранение аварийных выгрузок
- `EXPORT_LOCAL_DIR=./exports/emergency` — папка для XLSX

### 3. Запустить PostgreSQL 17

```bash
docker compose up -d
```

### 4. Применить миграции и seed

```bash
npx prisma migrate dev
npx prisma db seed
```

### 5. Запустить приложение

```bash
npm run dev
```

Приложение: http://localhost:3000

Проверка БД: http://localhost:3000/api/health

Ожидаемый ответ:

```json
{
  "ok": true,
  "database": "connected",
  "timezone": "Asia/Yekaterinburg",
  "timestamp": "..."
}
```

## Часовые пояса

- В базе даты и время хранятся в UTC (`timestamptz`).
- В интерфейсе время показывается в часовом поясе студии (`APP_TIMEZONE=Asia/Yekaterinburg`).

## Тестовые данные (seed)

Seed не содержит реальных персональных данных.

- Пользователи: `owner@example.local`, `manager@example.local`, `master1@example.local`, `master2@example.local`
- Пароль (для будущей авторизации на Шаге 2): `dev-password`
- Token-ссылка бота (тест): `test-bot-token-demo` → страница `/book/t/test-bot-token-demo`

## Аварийная выгрузка

На первом этапе заложены:

- таблица `emergency_exports` в Prisma;
- сервис `src/services/EmergencyExportService.ts`;
- локальная папка `exports/emergency/` (в `.gitignore`).

Реальная XLSX-выгрузка «today» end-to-end — отдельный ранний шаг после Bootstrap.

## API (запланировано)

- `GET /api/health` — проверка подключения к БД
- `GET /api/booking-links/:token` — данные token-ссылки от бота (Шаг позже)
- Публичная страница: `/book/t/:token`

## Деплой на Timeweb (позже)

Достаточно заменить `DATABASE_URL` на строку подключения Timeweb PostgreSQL 17 и выполнить:

```bash
npx prisma migrate deploy
npm run build
npm run start
```

## Полезные команды

```bash
npm run dev          # dev-сервер
npm run build        # production-сборка
npm run lint         # ESLint
npx prisma studio    # просмотр БД
docker compose down  # остановить PostgreSQL
```
