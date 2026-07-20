# Staging и Production — безопасный порядок запуска

Документ описывает подготовку **новой чистой PostgreSQL-базы** для staging/production.
Локальная dev-база **не переносится** и **не очищается**.

**Production Docker Compose** (отдельный контур, `127.0.0.1:3100`, без HTTPS): [`docs/operations/production-compose.md`](./operations/production-compose.md).

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
# Отредактируйте: AUTH_SECRET (≥32 символов), AUTH_URL, SCHEDULE_VIEW_TOKEN, пароли Postgres
```

Файл `.env.staging` / `.env.production` **не коммитится**.

Рекомендуемый секрет сессии: **`AUTH_SECRET`** (не `NEXTAUTH_SECRET`).

**`APP_ENV` и `AUTH_URL`:**

- Реальный production: `APP_ENV=production` и `AUTH_URL=https://ваш-домен` (разрешён только `https://`).
- Закрытый staging по SSH-туннелю (без домена и HTTPS): `APP_ENV=staging` и
  `AUTH_URL=http://127.0.0.1:3000`. HTTP допускается только для loopback
  (`127.0.0.1`, `localhost`, `::1`) и только при `APP_ENV=staging`.
- Без `APP_ENV=staging` вход падает с ошибкой
  `AUTH_URL должен использовать HTTPS в production`.

`docker-compose.staging.yml` пробрасывает `APP_ENV` в контейнер `app`, поэтому переменная
должна присутствовать в `.env.staging`.

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

Отдельно, после создания пяти канонических мастеров и backup staging.
Полный runbook: [`docs/operations/staging-catalog-import.md`](./operations/staging-catalog-import.md).

Кратко (локально / ops-контейнер, `APP_ENV=staging`):

```bash
npm run import:services
# запись только staging + явное подтверждение:
npm run import:services -- --apply --confirm-staging
```

Production apply запрещён. Seed каталог не наполняет.

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

## Аварийный сброс пароля OWNER

Если владелец потерял доступ (забыт пароль, нет публичного восстановления) —
сброс выполняется **только на сервере через SSH** в интерактивном терминале.

> ⚠️ **Runtime-контейнер `app` не подходит для запуска CLI.** Он собран из
> Next.js standalone (стадия `runner`) и содержит только `server.js`, `.next`,
> `public`, `prisma` и Prisma-клиент. В нём **нет** `scripts/`, `tsx` и полного
> `package.json`, поэтому запуск CLI внутри контейнера `app` (через
> `docker compose exec app npm run …`) завершится ошибкой. Используйте
> одноразовый **ops-образ** из стадии `builder`.

Ops-образ (`--target builder`) содержит полный исходный код, `scripts/`, все
зависимости (включая `tsx`) и сгенерированный Prisma-клиент — этого достаточно
для CLI и не раздувает основной runtime-образ.

**Шаг 1. Собрать актуальный ops-образ из свежего кода:**

```bash
cd /opt/online-zapis-tv && git pull --ff-only
docker build --target builder -t online-zapis-tv-ops:local .
```

`DATABASE_URL` берётся из уже запущенного контейнера `tvoe-vremya-staging-app`
(его значение **не** выводится в терминал) и передаётся в ops-контейнер только по
имени (`--env DATABASE_URL`), поэтому не попадает в историю shell и process list.
Никакие другие секреты из `.env.staging` (`AUTH_SECRET`, `SCHEDULE_VIEW_TOKEN` и
т.д.) в SSH-сеанс **не** экспортируются. Каждый сценарий — изолированный subshell
с `trap ... EXIT`, гарантированно очищающим переменные даже при ошибке.

**Шаг 2 (Сценарий A). Dry-run — база не изменяется, пароль не запрашивается:**

```bash
(
  set -e
  trap 'unset DATABASE_URL NET' EXIT
  cd /opt/online-zapis-tv
  DATABASE_URL="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' tvoe-vremya-staging-app | sed -n 's/^DATABASE_URL=//p')"
  test -n "$DATABASE_URL"
  NET="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' tvoe-vremya-staging-app | grep 'staging_internal$')"
  test "$(printf '%s\n' "$NET" | grep -c .)" -eq 1
  export DATABASE_URL
  docker run --rm -it --env DATABASE_URL --network "$NET" online-zapis-tv-ops:local npm run owner:reset-password -- --email owner@your-domain.ru --dry-run
)
```

**Шаг 2 (Сценарий B). Реальный аварийный сброс — новый пароль вводится интерактивно (скрыто, дважды):**

```bash
(
  set -e
  trap 'unset DATABASE_URL NET' EXIT
  cd /opt/online-zapis-tv
  DATABASE_URL="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' tvoe-vremya-staging-app | sed -n 's/^DATABASE_URL=//p')"
  test -n "$DATABASE_URL"
  NET="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' tvoe-vremya-staging-app | grep 'staging_internal$')"
  test "$(printf '%s\n' "$NET" | grep -c .)" -eq 1
  export DATABASE_URL
  docker run --rm -it --env DATABASE_URL --network "$NET" online-zapis-tv-ops:local npm run owner:reset-password -- --email owner@your-domain.ru
)
```

Определение сети однозначно: имена сетей берутся напрямую из контейнера
`tvoe-vremya-staging-app`, фильтруются по суффиксу `staging_internal`, и `test`
завершает subshell с ошибкой, если совпадений не ровно одно (сеть отсутствует
или неоднозначна). Глобальный список сетей хоста для этого не используется.

Проверка интерактивного TTY (опционально, секретов не выводит — ожидается `true`/`true`):

```bash
docker run --rm -it online-zapis-tv-ops:local \
  node -e "console.log('stdin TTY:', process.stdin.isTTY===true, '| stdout TTY:', process.stdout.isTTY===true)"
```

`docker run -it` (`-i` — открытый stdin, `-t` — псевдо-TTY) внутри интерактивной
SSH-сессии делает и `stdin`, и `stdout` контейнера TTY, поэтому скрытый prompt
(`promptHidden` → `assertInteractiveTerminal`) работает. Без `-it` или в
неинтерактивном режиме ввод пароля намеренно отклоняется.

Правила безопасности:

- запускать **только** через SSH на сервере, в **интерактивном** терминале (TTY) с `-it`;
- пароль **не** передавать в команде, аргументах, переменных окружения или файле —
  флаг `--password` отклоняется, ввод возможен только через скрытый prompt;
- новый пароль вводится дважды (первый ввод + подтверждение), символы не отображаются;
- пароль проходит ту же политику (`validatePasswordPolicy`, ≥12 символов) и хешируется
  тем же bcrypt, что при обычном входе и создании OWNER;
- обновление атомарно: `passwordHash` + `passwordChangedAt` меняются одной транзакцией,
  неиспользованные `PasswordResetToken` пользователя удаляются;
- после сброса **все прежние сессии автоматически отзываются** (проверка `passwordChangedAt`),
  войдите заново новым паролем;
- сброс доступен строго для роли `OWNER`; для остальных ролей команда завершится отказом.

## Служебная почта (SMTP)

Служебные письма отправляются через SMTP Mail.ru с ящика `ipku82@bk.ru`.

Правила безопасности пароля:

- **основной** пароль почтового ящика **не используется**;
- используется **отдельный пароль внешнего приложения** Mail.ru с правом
  «Только отправка писем в Почте / SMTP»;
- реальный пароль хранится **только** в закрытом server env (`.env.staging` на
  сервере) и вносится владельцем вручную;
- пароль **запрещено** добавлять в GitHub, чат, скриншоты и shell-команды
  (в т.ч. в аргументы `docker run`/`npm`);
- в репозитории и `.env.production.example` — только пустой placeholder
  `SMTP_PASSWORD=`.

Параметры Mail.ru/BK (несекретные):

| Переменная | Значение |
| --- | --- |
| `MAIL_PROVIDER` | `smtp` (или `disabled`, чтобы выключить почту) |
| `MAIL_FROM_NAME` | `Твоё время` |
| `MAIL_FROM_ADDRESS` | `ipku82@bk.ru` |
| `SMTP_HOST` | `smtp.mail.ru` |
| `SMTP_PORT` | `465` (SSL/TLS) |
| `SMTP_SECURE` | `true` |
| `SMTP_USER` | `ipku82@bk.ru` |
| `SMTP_PASSWORD` | пароль внешнего приложения — только в server env |
| `SMTP_IP_FAMILY` | `auto` (по умолчанию), `4` или `6` — см. ниже |

**Выбор IP-семейства (`SMTP_IP_FAMILY`):**

- `auto` — динамически получить A, затем AAAA и перебрать адреса (IPv4 предпочтительнее);
  если DNS пуст — подключение по имени `SMTP_HOST`;
- `4` — динамически получить A-записи хоста и подключаться по IPv4;
- `6` — динамически получить AAAA-записи и подключаться по IPv6.

IP-адрес **никогда** не прописывается жёстко в конфиге — только через DNS при
каждом подключении. При подключении к IP Nodemailer использует исходное имя
хоста в `tls.servername` (корректная проверка TLS-сертификата). Если один адрес
из DNS недоступен на этапе TCP/TLS (`command=CONN` и connect-level код ошибки),
безопасно пробуется следующий; после начала SMTP-транзакции повторная отправка
не выполняется.

`npm run build` после сборки проверяет standalone-контракт nodemailer
(`test:security:mail-standalone`); без успешного build production-образ не должен
собираться.

На staging, если исходящий IPv4 к `smtp.mail.ru` недоступен (таймаут), а IPv6
работает, задайте в `.env.staging`:

```dotenv
SMTP_IP_FAMILY=6
```

Пересоздайте контейнер `app` после изменения env. Работает с любым SMTP-провайдером,
не только Mail.ru.

### IPv6 в Docker-сети staging

Контейнер `app` должен иметь исходящий IPv6 в сети `staging_internal`, иначе
`SMTP_IP_FAMILY=6` не сможет подключиться к `smtp.mail.ru` по AAAA-записям.

В `docker-compose.staging.yml` для сети задано только `enable_ipv6: true` — Docker
сам выделяет IPv6-подсеть (без ручного `ipam`), привязка к host-сети и новые
публичные порты **не** используются.

**Безопасное пересоздание сети** (volumes Postgres и `emergency_exports` сохраняются):

1. Остановить стек **без** `-v` (флаг `-v` удалил бы volumes — не используйте его):
   ```bash
   docker compose -f docker-compose.staging.yml --env-file .env.staging down
   ```
2. Убедиться, что staging-контейнеры остановлены (`docker ps` не показывает
   `tvoe-vremya-staging-*`).
3. Если после `down` сеть `*staging_internal` осталась (создана без IPv6), удалить её:
   ```bash
   docker network ls --filter name=staging_internal --format '{{.Name}}'
   docker network rm <имя_сети>
   ```
   Выполняйте только когда контейнеры уже остановлены.
4. Поднять стек заново — сеть создаётся с `enable_ipv6: true`:
   ```bash
   docker compose -f docker-compose.staging.yml --env-file .env.staging up -d
   ```

**Проверка IPv6 в контейнере `app`** (на сервере, без вывода секретов):

```bash
(
  set -euo pipefail
  CID="tvoe-vremya-staging-app"
  test -n "$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.GlobalIPv6Address}}{{end}}' "$CID")"

  docker exec "$CID" node -e "
    const dns = require('node:dns/promises');
    const net = require('node:net');
    (async () => {
      const host = 'smtp.mail.ru';
      const addrs = await dns.resolve6(host);
      console.log('AAAA_RESOLVED=' + (addrs.length > 0));
      const ip = addrs[0];
      await new Promise((resolve, reject) => {
        const s = net.createConnection({ host: ip, port: 465, family: 6 }, resolve);
        s.on('error', reject);
        s.setTimeout(10000, () => { s.destroy(); reject(new Error('timeout')); });
      });
      console.log('APP_IPV6_TCP_OK');
    })().catch((e) => { console.error(e.message); process.exit(1); });
  "
)
```

Ожидается: `AAAA_RESOLVED=true` и `APP_IPV6_TCP_OK`. Затем выполните сценарий
`mail:test` из раздела ниже.

Если `MAIL_PROVIDER=disabled` (или пусто), приложение стартует **без** SMTP и
сетевые подключения к почте не выполняются. При `MAIL_PROVIDER=smtp` env-валидация
fail-closed требует непустые `MAIL_FROM_ADDRESS`/`SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`,
корректный email отправителя, порт в диапазоне и `SMTP_SECURE=true` для порта 465.

### Тестовая отправка (только на сервере)

Правильный порядок серверной проверки (реальные команды на этом этапе не выполняются):

1. вручную внести mail-переменные в закрытый `.env.staging` (права доступа только владельцу);
2. пересоздать контейнер `app`, чтобы он получил новые mail-переменные:
   `docker compose -f docker-compose.staging.yml --env-file .env.staging up -d app`;
3. собрать актуальный ops-образ: `docker build --target builder -t online-zapis-tv-ops:local .`;
4. выполнить безопасный subshell-сценарий `mail:test` (ниже);
5. проверить получение нейтрального тестового письма;
6. использовать **только** пароль внешнего приложения, **не** основной пароль почты.

> ⚠️ **Нельзя** запускать `mail:test` через `docker run --env-file .env.staging`:
> это передаст в ops-контейнер весь файл, включая `AUTH_SECRET`, `DATABASE_URL`,
> `SCHEDULE_VIEW_TOKEN` и другие секреты, которые CLI отправки письма не нужны.

CLI зависит только от девяти mail-переменных. Извлекаем их из уже пересозданного
контейнера `tvoe-vremya-staging-app` потоково (по одному имени, без сохранения
всего вывода `docker inspect`), значения не печатаются, а в `docker run`
передаются только **имена** переменных (`--env ИМЯ`):

```bash
(
  set -euo pipefail

  MAIL_VARS="MAIL_PROVIDER MAIL_FROM_NAME MAIL_FROM_ADDRESS SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASSWORD SMTP_IP_FAMILY"

  cleanup_mail_env() {
    for name in $MAIL_VARS; do
      unset "$name"
    done
    unset MAIL_VARS
    unset -f read_mail_env cleanup_mail_env
  }

  trap cleanup_mail_env EXIT

  read_mail_env() {
    local name="$1"
    local value

    value="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' tvoe-vremya-staging-app | sed -n "s/^${name}=//p")"

    test -n "$value"

    printf -v "$name" '%s' "$value"
    export "$name"
  }

  for name in $MAIL_VARS; do
    read_mail_env "$name"
  done

  docker run --rm \
    --env MAIL_PROVIDER \
    --env MAIL_FROM_NAME \
    --env MAIL_FROM_ADDRESS \
    --env SMTP_HOST \
    --env SMTP_PORT \
    --env SMTP_SECURE \
    --env SMTP_USER \
    --env SMTP_PASSWORD \
    --env SMTP_IP_FAMILY \
    online-zapis-tv-ops:local \
    npm run mail:test -- --to recipient@example.com
)
```

Свойства сценария:

- изолированный subshell `( ... )` с `set -euo pipefail`; без трассировки команд
  и без автоэкспорта всех переменных окружения;
- `.env.staging` целиком **не** загружается в shell и **не** передаётся контейнеру;
- из контейнера извлекаются **только** девять разрешённых mail-переменных, по одной;
- каждая переменная проверяется `test -n` (пустое значение прерывает сценарий);
- в `docker run` передаются только имена (`--env ИМЯ`), без `--env ИМЯ=значение`;
- значение `SMTP_PASSWORD` не печатается и не попадает в argv/историю/документацию;
- `trap cleanup_mail_env EXIT` гарантированно очищает переменные при завершении и ошибке;
- письмо **нейтральное**: без токенов и ссылок восстановления
  (публичного домена/HTTPS ещё нет, сценарий «Забыли пароль?» не реализован);
- вывод — только факт успешной отправки либо обобщённое `[mail] delivery failed`.

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
