# Manage-link token storage: expand / contract

Дата: 2026-07-18  
Связано с: hardening manage-link, [bot-booking-notifications.md](./bot-booking-notifications.md)

## Почему не hash-only в одном релизе

Production rollback сохраняет **предыдущий app image**, который умеет только `appointments.manage_token`.

Если новый релиз пишет **только** `manage_token_hash` (`manage_token = null`), а затем откатывает app:

- старый image ищет по plaintext;
- новые записи после expand **не находятся** по manage-link.

Поэтому используется **два релиза**: Phase A EXPAND → Phase B CONTRACT.

## Порядок production-deploy.sh

Фактический порядок ops (не менять ради этой фичи):

1. backup (если применимо);
2. build images (новый image + tag rollback предыдущего);
3. **`prisma migrate deploy`** (expand-миграция до старта новой app);
4. restart app container на новый image.

Следствие: expand-миграция должна быть безопасна для **ещё работающего старого app** до момента restart, и для rollback image после restart.

## Phase A / EXPAND (текущий релиз)

Миграция `20260718220000_appointment_manage_token_hash`:

- `CREATE EXTENSION IF NOT EXISTS pgcrypto` (нужны права на extension **или** уже установленный `pgcrypto` — как после legal-миграции);
- добавить `manage_token_hash`;
- backfill hash из существующего plaintext (без вывода raw token);
- unique index на hash;
- **не** удалять `manage_token`.

Приложение Phase A:

- **dual-read:** hash → legacy plaintext (+ lazy backfill hash);
- **dual-write** новых ONLINE токенов: plaintext **и** hash;
- raw token **не** в `AppointmentDto` / staff API / logs; выдача только один раз как `manageUrl` при create;
- независимый `requestReference`;
- rate limit, same-origin POST, no-store, Referrer-Policy, единые ошибки.

### Временный риск Phase A

Plaintext в БД **временно сохраняется** (dual-write) **только** ради rollback на pre-hash image.  
Это **не** финальное устранение plaintext.

### Что уже защищено в Phase A

- hash заполнен для старых и новых строк (backfill + dual-write);
- lookup по hash готов;
- утечки через DTO/API/legal reference закрыты;
- manage route hardening.

## Phase B / CONTRACT (follow-up TODO — не в этом релизе)

Выполнять **только после** успешного production deploy Phase A, когда rollback image уже = Phase A (умеет hash lookup).

1. **Release B1 — hash-only write:** новые записи пишут только `manage_token_hash`, `manage_token = null`. Rollback image (Phase A) читает hash → ссылки живы.
2. **Наблюдение:** убедиться, что нет plaintext-only строк без hash; spot-check manage-link.
3. **Release B2 — code:** отключить plaintext dual-read / dual-write.
4. **Release B3 — migration:** `DROP COLUMN manage_token` (отдельная миграция).

Не объединять B1–B3 в один шаг с Phase A.

## Матрица совместимости

| Состояние | Старые plaintext-only строки | Новые строки Phase A (dual-write) | Hash-only строки (после B1) |
|---|---|---|---|
| Pre-hash app | OK (plaintext) | OK (plaintext) | **сломано** |
| Phase A app | OK (dual-read) | OK | OK (hash) |
| Phase B app (после B2) | OK если hash backfilled | OK | OK |
