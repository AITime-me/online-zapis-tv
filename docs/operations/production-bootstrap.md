# Production bootstrap канонических рабочих данных

Отдельная ручная операция для чистой production-базы после migrate и foundation seed. **Не** вызывается из deploy, rollback, backup timer или restore.

Связанные документы:

- [Production compose](./production-compose.md) — контуры и env
- [Production deploy](./production-deploy.md) — deploy не делает bootstrap
- [Production backup](./production-backup.md) — общий lock и dump
- [Production restore](./production-restore.md) — восстановление БД (отдельная операция)
- [STAGING_PRODUCTION.md](../STAGING_PRODUCTION.md) — foundation seed и OWNER

## Обязательный порядок

1. `prisma migrate deploy` (через production deploy / migrator)
2. `npm run db:seed:production` — foundation (settings, legal, GameConfig OFF, GameCatalog `procedure-gift` DISABLED)
3. **`production-bootstrap-data.sh`** — мастера, каталог, gifts, витринная скидка
4. `npm run owner:create` — первый OWNER (отдельная команда)

Запрещено: перенос staging DB, `db:seed` (dev), автоматический bootstrap из deploy.

## Канонические источники

| Данные | Источник |
|---|---|
| Мастера, категории, услуги, цены, bindings | `scripts/data/import-services-data.ts` (101 услуга, 5 мастеров, 11 категорий) |
| 4 подарка + витрина −30% | `scripts/ops/lib/game-promotions-canonical.ts` (shared; staging restore импортирует тот же источник) |
| Расчёт скидки 30% | только `src/lib/promo/promo-engine.ts` (`cold-plasma-first-visit-30`) — **не меняется** |

Стабильные UUID: мастера и категории — явный business key → UUID; услуги — уникальный import `num`. Не array index.

## Что создаётся

- 5 канонических мастеров (`usesDefaultWorkHours=true`, без User/OWNER)
- 11 категорий и 101 услуга с `master_services`
- 4 GameGift с привязкой к `procedure-gift`
- DB Promotion витрины `skidka-30-holodnaya-plazma` (ACTIVE, бессрочная, homepage, CTA `/booking`)
- маркетинговые `promotion_services` только на услуги категории «Холодная плазма» (не участвуют в расчёте цены)

## Что не создаётся

OWNER/MANAGER, клиенты, записи, заявки, game sessions/plays, `@example.local`, коммуникации, demo promotions, Bot/VK настройки, история staging. Игра **не включается**.

## Dry-run

```bash
cd /opt/online-zapis-tv-production
bash scripts/ops/production-bootstrap-data.sh --dry-run
```

Без lock, backup и записей. Показывает counts create/noop/conflict и список сущностей.

## Apply

```bash
bash scripts/ops/production-bootstrap-data.sh --apply
```

Подтверждение (точная фраза):

```
BOOTSTRAP PRODUCTION DATA
```

Перед записью: общий flock `backups/production/deploy-state/.production-ops.lock` и verified pre-bootstrap dump (`*prebootstrap*`).

Семантика:

- одна транзакция Prisma;
- повтор на полностью совпадающих данных — no-op;
- конфликт ID/slug/полей — fail-fast, **без** записи;
- неизвестные ручные записи не удаляются и не отключаются.

## Игра остаётся выключенной

После bootstrap:

- `GameConfig.isActive=false`
- `GameCatalog.procedure-gift` status ≠ ACTIVE (`DISABLED`)
- `isPrimaryPublic=false`
- `PREMIUM_TIERS_ENABLED` не включается (код)

Подарки могут быть `isActive=true` в каталоге, но public API игры закрыт существующими gate.

### Как включить игру позже (вручную)

Только отдельным осознанным действием в админке / SQL после проверки подарков и политик — **не** частью этого скрипта.

## Скидка 30%

| Слой | Роль |
|---|---|
| `promo-engine` `cold-plasma-first-visit-30` | единственный расчёт скидки при записи |
| DB Promotion `skidka-30-holodnaya-plazma` | карточка витрины/карусели |

DB-карточка **не** дублирует движок и не перечисляет 13 зон текстом.

## Manifest

`backups/production/deploy-state/*_bootstrap.env` — без секретов: timestamp, commit, backup path, `BOOTSTRAP_STATUS`, counts, `GAME_REMAINS_DISABLED=1`.

## Post-check (ориентиры)

CLI выполняет post-check автоматически после apply. Вручную можно проверить:

```sql
SELECT COUNT(*) FROM masters;           -- ≥ 5 канонических
SELECT COUNT(*) FROM services;          -- ≥ 101 канонических
SELECT COUNT(*) FROM game_gifts
  WHERE id IN (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444'
  );                                    -- = 4
SELECT is_active FROM game_config WHERE id = 'default';  -- false
SELECT status, is_primary_public FROM game_catalog WHERE slug = 'procedure-gift';
SELECT slug, status, is_active, show_on_homepage, starts_at, ends_at
  FROM promotions WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
```

## Security-тест

```bash
npm run test:security:production-bootstrap
```
