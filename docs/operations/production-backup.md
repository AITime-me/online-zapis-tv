# Ежедневный backup PostgreSQL на production

Регулярный backup production-базы выполняется скриптом `scripts/ops/production-backup.sh` и (после ручной установки) systemd timer. Скрипт **не** останавливает приложение. Pre-deploy backup в `production-deploy.sh` остаётся отдельным шагом deploy.

Связанные документы:

- [Production deploy](./production-deploy.md) — deploy, rollback, общий lock
- [Production compose](./production-compose.md) — контуры и env
- [Staging backup](./staging-backup.md) — отдельный staging-контур

> **Restore базы в этой задаче не реализован** — будет отдельным этапом.

## Важно о рисках

Локальные backup в `backups/production/postgres/` на том же сервере **не защищают** от потери хоста или диска. Для аварийного восстановления нужна копия dump **вне** production-сервера.

## Размещение

| Параметр | Значение |
| --- | --- |
| Checkout | `/opt/online-zapis-tv-production` |
| Env | `.env.production` (`APP_ENV=production`) |
| Каталог backup | `backups/production/postgres/` |
| Lock | `backups/production/deploy-state/.production-ops.lock` |
| Retention | **30 дней** (`PRODUCTION_BACKUP_RETENTION_DAYS`) |
| Имя файла | `YYYYMMDDTHHMMSSZ_<short-sha>.dump` |

Deploy backup использует тот же шаблон имени и тот же каталог; retention удаляет любые проверенные `*.dump` старше 30 дней **только** внутри `backups/production/postgres/`.

## Требования

- Пользователь `deploy`, репозиторий в `/opt/online-zapis-tv-production`
- `APP_ENV=production` в `.env.production`
- Docker и контейнер `tvoe-vremya-production-postgres` в состоянии `healthy`
- Каталог `backups/` в `.gitignore`

Секреты читаются только через `ops_read_env_value`. Пароли и `DATABASE_URL` **не** выводятся в лог и manifest.

## Блокировка (общий lock с deploy/rollback)

Backup использует тот же `flock` на `backups/production/deploy-state/.production-ops.lock`, что deploy и rollback. Параллельный backup не запустится во время deploy. `--dry-run` lock **не** берёт.

## Dry-run

Проверка окружения и план без создания файлов, lock и удаления:

```bash
cd /opt/online-zapis-tv-production
bash scripts/ops/production-backup.sh --dry-run
```

Показывает путь будущего dump и список файлов, которые **бы** удалились по retention.

## Ручной backup

```bash
cd /opt/online-zapis-tv-production
bash scripts/ops/production-backup.sh
```

Интерактивное подтверждение **не** требуется. После успешного backup выполняется retention (30 дней по умолчанию).

Другой срок хранения:

```bash
bash scripts/ops/production-backup.sh --retention-days 30
```

Результат:

- dump в `backups/production/postgres/YYYYMMDDTHHMMSSZ_<short-sha>.dump` (права `600`)
- manifest в `backups/production/deploy-state/YYYYMMDDTHHMMSSZ_backup.env` (без секретов)

## Retention 30 дней

- Константа: `PRODUCTION_BACKUP_RETENTION_DAYS=30` в `production-ops-common.sh`
- Удаляются только файлы `*.dump` с распознаваемым UTC-префиксом в имени
- Каталог проверяется через абсолютный путь `backups/production/postgres`
- Retention запускается **только после** успешного создания и verify нового backup
- Staging-каталоги, manifests deploy и файлы вне production backup dir **не** затрагиваются

## Проверка созданного dump

```bash
ls -l backups/production/postgres/

docker cp backups/production/postgres/YYYYMMDDTHHMMSSZ_<sha>.dump \
  tvoe-vremya-production-postgres:/tmp/verify.dump
docker exec tvoe-vremya-production-postgres pg_restore -l /tmp/verify.dump >/dev/null
docker exec tvoe-vremya-production-postgres rm -f /tmp/verify.dump
```

## Установка systemd timer

Шаблоны в репозитории (не устанавливаются автоматически из CI):

- `deploy/systemd/production/online-zapis-tv-production-backup.service`
- `deploy/systemd/production/online-zapis-tv-production-backup.timer`

План установки (без изменений):

```bash
cd /opt/online-zapis-tv-production
bash scripts/ops/install-production-backup-timer.sh --dry-run
```

Применение на сервере (вручную, с sudo):

```bash
bash scripts/ops/install-production-backup-timer.sh --install
```

Или вручную:

```bash
sudo cp deploy/systemd/production/online-zapis-tv-production-backup.service /etc/systemd/system/
sudo cp deploy/systemd/production/online-zapis-tv-production-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable online-zapis-tv-production-backup.timer
sudo systemctl start online-zapis-tv-production-backup.timer
```

### Следующий запуск

```bash
systemctl list-timers online-zapis-tv-production-backup.timer
```

### Ручной запуск service (без ожидания timer)

```bash
sudo systemctl start online-zapis-tv-production-backup.service
```

### Статус и journal

```bash
systemctl status online-zapis-tv-production-backup.service
journalctl -u online-zapis-tv-production-backup.service -n 50 --no-pager
```

Timer: **02:30** по часовому поясу студии `Asia/Yekaterinburg`, `Persistent=true`, `RandomizedDelaySec=900`.

## Отключение timer

```bash
sudo systemctl stop online-zapis-tv-production-backup.timer
sudo systemctl disable online-zapis-tv-production-backup.timer
sudo rm -f /etc/systemd/system/online-zapis-tv-production-backup.service \
           /etc/systemd/system/online-zapis-tv-production-backup.timer
sudo systemctl daemon-reload
```

Существующие dump в `backups/production/postgres/` **не** удаляются.

## Проверка безопасности

```bash
npm run test:security:production-backup
npm run test:security:production-ops
```
