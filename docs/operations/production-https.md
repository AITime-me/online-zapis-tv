# Production HTTPS / reverse proxy (Caddy)

Публичный HTTPS для `tvoio-vremya.ru` через **Caddy как systemd-сервис на Ubuntu-хосте** (не Docker).  
Application: `127.0.0.1:3100`. Staging `127.0.0.1:3000` **не** публикуется.

Связанные документы:

- [Production compose](./production-compose.md)
- [Production deploy](./production-deploy.md)
- [Production backup](./production-backup.md)

## A. Что подготовлено в репозитории

| Файл | Назначение |
|---|---|
| `deploy/caddy/Caddyfile.production` | Caddy: apex + www redirect → `127.0.0.1:3100` |
| `scripts/ops/install-production-reverse-proxy.sh` | Helper установки Caddyfile (`--dry-run` / `--install`) |
| `.env.production.example` | `AUTH_URL=https://tvoio-vremya.ru`, `TRUST_PROXY_HEADERS=true`, `APP_PORT=3100` |

Архитектура:

```text
Internet :80/:443
  → Caddy (systemd на хосте, автоматический HTTPS)
  → reverse_proxy 127.0.0.1:3100
  → tvoe-vremya-production-app
  → PostgreSQL только во внутренней Docker-сети
```

Next.js уже отдаёт базовые security headers и CSP Report-Only. Caddy **не** дублирует CSP и **не** включает HSTS preload на этом этапе.

## B. DNS в Timeweb (вручную, позже)

Создать **только** записи для веб-трафика. **Не** удалять и **не** редактировать существующие MX и TXT/SPF.

| Тип | Хост | Значение |
|---|---|---|
| A | `@` | `72.56.0.12` |
| CNAME | `www` | `tvoio-vremya.ru` |

Если Timeweb не примет CNAME для `www`, допустимо: **A** `www` → `72.56.0.12`.

На первом этапе **не** создавать AAAA (только IPv4).

## C. Перед применением

1. Production app отвечает: `curl -fsS http://127.0.0.1:3100/api/health`
2. Порты 80/443 свободны или уже заняты **caddy** (чужие процессы helper не останавливает)
3. DNS apex и www резолвятся в `72.56.0.12`
4. Установить Caddy из **официального** Ubuntu-репозитория по [документации Caddy](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) — **не** этот helper
5. В `.env.production`: `AUTH_URL=https://tvoio-vremya.ru`, `TRUST_PROXY_HEADERS=true`, затем redeploy/recreate app при необходимости
6. Платный сертификат **не** нужен: Caddy выпускает и продлевает TLS автоматически

## D. Команды

```bash
cd /opt/online-zapis-tv-production

# План без изменений
bash scripts/ops/install-production-reverse-proxy.sh --dry-run

# Установка Caddyfile
bash scripts/ops/install-production-reverse-proxy.sh --install
# → ввести: INSTALL PRODUCTION REVERSE PROXY
```

Диагностика:

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl status caddy
journalctl -u caddy -n 100 --no-pager

curl -fsS http://127.0.0.1:3100/api/health
curl -fsS https://tvoio-vremya.ru/api/health
```

Ожидаемый JSON health: `"ok":true` и `"status":"healthy"`.

## E. Rollback конфигурации proxy

При ошибке validate/reload/health helper сам пытается вернуть предыдущий `/etc/caddy/Caddyfile` и сделать `systemctl reload caddy`.

Вручную:

```bash
sudo cp /var/backups/online-zapis-tv-production-caddy/<timestamp>_Caddyfile.bak /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

Production Docker-контейнеры и PostgreSQL при rollback proxy **не** откатываются.

## F. Staging

HTTPS для staging этим шагом **не** настраивается. `127.0.0.1:3000` остаётся недоступным извне.

## Security-тест

```bash
npm run test:security:production-https
```
