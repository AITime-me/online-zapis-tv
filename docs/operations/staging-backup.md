# Ежедневный backup PostgreSQL на staging

Регулярный backup staging-базы выполняется скриптом `scripts/ops/staging-backup-db.sh` и (после ручной установки) systemd timer. Скрипт **не** останавливает приложение и **не** заменяет backup перед deploy.

## Важно о рисках

Локальные backup в `backups/postgres/` на том же сервере **не защищают** от потери самого сервера, диска или каталога `/opt`. Для аварийного восстановления нужна копия dump **вне** staging-хоста (object storage, другой сервер, offline media).

## Типы backup в `backups/postgres/`

| Тип | Имя файла | Кто создаёт | Retention этого скрипта |
| --- | --- | --- | --- |
| Deploy | `YYYYMMDDTHHMMSSZ_<short-sha>.dump` | `staging-deploy.sh` | Никогда не удаляется |
| Pre-restore | `YYYYMMDDTHHMMSSZ_prerestore.dump` | `staging-restore-db.sh` | Никогда не удаляется |
| Scheduled | `YYYYMMDDTHHMMSSZ_scheduled.dump` | `staging-backup-db.sh` | По `--retention-days` (по умолчанию 14) |
| Ручные / прочие | любое другое имя | оператор | Никогда не удаляется |

## Требования

- Пользователь `deploy`, репозиторий в `/opt/online-zapis-tv`
- `APP_ENV=staging` в `.env.staging`
- Docker и контейнер `tvoe-vremya-staging-postgres` в состоянии `healthy`
- Каталог `backups/` в `.gitignore` (проверяется скриптом)

Секреты читаются только через `ops_read_env_value` из `.env.staging`. Пароли и `DATABASE_URL` **не** выводятся в лог.

## Блокировка (общий lock с deploy/restore)

Scheduled backup использует тот же `flock` на `backups/deploy-state/.deploy.lock`, что deploy и restore. Параллельный backup не запустится во время deploy, restore или другого backup. `--dry-run` lock не берёт.

## Dry-run

Проверка окружения и план без создания файлов:

```bash
cd /opt/online-zapis-tv
bash scripts/ops/staging-backup-db.sh --dry-run
```

## Ручной backup

```bash
cd /opt/online-zapis-tv
bash scripts/ops/staging-backup-db.sh
```

С другим сроком хранения scheduled backup:

```bash
bash scripts/ops/staging-backup-db.sh --retention-days 30
```

Результат:

- dump в `backups/postgres/YYYYMMDDTHHMMSSZ_scheduled.dump` (права `600`)
- manifest в `backups/deploy-state/YYYYMMDDTHHMMSSZ_scheduled_backup.env` (без секретов)

## Проверка созданного dump

```bash
# список scheduled backup
ls -l backups/postgres/*_scheduled.dump

# проверка формата (в контейнере postgres)
docker cp backups/postgres/YYYYMMDDTHHMMSSZ_scheduled.dump \
  tvoe-vremya-staging-postgres:/tmp/verify.dump
docker exec tvoe-vremya-staging-postgres pg_restore -l /tmp/verify.dump >/dev/null
docker exec tvoe-vremya-staging-postgres rm -f /tmp/verify.dump
```

Или восстановление через существующий [staging-restore-db.md](./staging-deploy.md#ручное-восстановление-базы) (только в тестовом окне, с подтверждением).

## Установка systemd timer (вручную на сервере)

Шаблоны в репозитории (не устанавливаются автоматически):

- `deploy/systemd/staging/online-zapis-tv-staging-backup.service`
- `deploy/systemd/staging/online-zapis-tv-staging-backup.timer`

```bash
sudo cp deploy/systemd/staging/online-zapis-tv-staging-backup.service /etc/systemd/system/
sudo cp deploy/systemd/staging/online-zapis-tv-staging-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable online-zapis-tv-staging-backup.timer
sudo systemctl start online-zapis-tv-staging-backup.timer
```

Проверить следующий запуск:

```bash
systemctl list-timers online-zapis-tv-staging-backup.timer
```

Ручной запуск service (без ожидания timer):

```bash
sudo systemctl start online-zapis-tv-staging-backup.service
```

Журнал:

```bash
journalctl -u online-zapis-tv-staging-backup.service -n 50 --no-pager
```

Timer по умолчанию: `OnCalendar=*-*-* 22:15:00` (локальное время сервера) + `RandomizedDelaySec=900` + `Persistent=true` (пропущенный запуск выполнится после включения сервера). При необходимости скорректируйте время в unit под часовой пояс сервера.

## Отключение timer

```bash
sudo systemctl stop online-zapis-tv-staging-backup.timer
sudo systemctl disable online-zapis-tv-staging-backup.timer
sudo rm -f /etc/systemd/system/online-zapis-tv-staging-backup.service \
           /etc/systemd/system/online-zapis-tv-staging-backup.timer
sudo systemctl daemon-reload
```

Существующие файлы в `backups/postgres/` при этом **не** удаляются.

## Связанные файлы

| Файл | Назначение |
| --- | --- |
| `scripts/ops/staging-backup-db.sh` | Scheduled backup + retention |
| `scripts/ops/lib/staging-ops-common.sh` | Общие функции backup/verify/lock |
| `scripts/ops/staging-deploy.sh` | Backup перед deploy |
| `scripts/ops/staging-restore-db.sh` | Ручной restore |
| `docs/operations/staging-deploy.md` | Deploy и restore |

## Проверка безопасности

```bash
npm run test:security:staging-ops
```
