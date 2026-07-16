# Восстановление канонических подарков игры и витринной карточки скидки (staging)

Ручной ops-инструмент `scripts/ops/staging-restore-game-promotions.sh` идемпотентно upsert’ит:

- 4 канонических `game_gifts` для каталога `procedure-gift` (со стабильными UUID и обязательным `gameCatalogId`);
- одну витринную карточку скидки `-30%` на холодную плазму для homepage carousel.

Инструмент **не** входит в обычный deploy и **не** включает игру.

## Что восстанавливается

| Сущность | Детали |
| --- | --- |
| Gifts | Уход для рук / Холодная плазма губ / Лазерная биоревитализация / Формула сияния |
| Promotion | `skidka-30-holodnaya-plazma` (`dddddddd-…`), `ACTIVE`, `showOnHomepage=true`, CTA → `/booking` |

Не создаются: демо-акции («Летнее сияние…», «Подбор процедуры…»), отдельная DB-карточка игры, связи `promotion_services` по зонам.

## Важно: скидка vs витрина

- **Расчёт скидки 30%** по-прежнему только в `promo-engine` (`cold-plasma-first-visit-30`).
- Запись в таблице `promotions` нужна **только** для карусели на главной и админской витрины.
- Она **не** участвует во втором расчёте цены онлайн-записи.

## Важно: игра остаётся выключенной

Restore **fail-fast**, если `game_config.default.is_active=true` или каталог `procedure-gift` в статусе `ACTIVE`.  
После успешного apply каталог и config остаются выключенными. Включение — только вручную в админке.

«Формула сияния» появляется в каталоге подарков (`requiredPremiumLevel=2`), но при `PREMIUM_TIERS_ENABLED=false` серверный pool её не выбирает.

## Требования

- Пользователь `deploy`, репозиторий в `/opt/online-zapis-tv`
- `APP_ENV=staging` в `.env.staging`
- Docker, healthy postgres
- Общий lock `backups/deploy-state/.deploy.lock`
- Секреты не печатаются

Перед apply создаётся PostgreSQL backup `*_pre-game-promotions.dump`.

## Dry-run

```bash
cd /opt/online-zapis-tv
bash scripts/ops/staging-restore-game-promotions.sh --dry-run
```

Проверяет окружение, печатает план и читает БД без записи. Lock/backup не берутся.

## Apply

```bash
cd /opt/online-zapis-tv
bash scripts/ops/staging-restore-game-promotions.sh
```

Интерактивно введите точную фразу:

```text
RESTORE GAME PROMOTIONS
```

Скрипт:

1. берёт staging ops lock;
2. делает pre-change backup;
3. пересобирает migrator (нужен актуальный CLI в образе);
4. выполняет upsert в transaction через Prisma CLI в migrator;
5. post-check (4 gift UUID, catalog binding, tier probs, showcase card, game still disabled);
6. пишет manifest без секретов в `backups/deploy-state/*_game_promotions_restore.env`.

## Проверка результата

- Админка `/admin/games/[id]` → блок «Подарки» содержит 4 позиции.
- Главная: витринная карточка скидки видна (если homepage eligibility ок).
- Карточка игры на главной по-прежнему динамическая и появляется только после ручного включения игры.
- Онлайн-запись: скидка по-прежнему из `promo-engine`, без второго расчёта из DB promotion.
