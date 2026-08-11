# 05 — Bot Core и база знаний

## Bot Core владеет

- входящими событиями;
- диалоговым состоянием;
- очередями;
- AI-маршрутизацией;
- handoff менеджеру;
- защитой от двойных ответов;
- inbox/outbox собственного контура;
- повторной доставкой;
- reconciliation.

Канон экосистемы: AI-провайдер по умолчанию — `NONE` (в control plane `online-zapis-tv` уже так;
в `bot-TV` отдельного provider enum пока нет — AI не подключён).
Все каналы и автоматические действия по умолчанию выключены.

Bot Core **не** владеет каталогом услуг/цен/мастеров/расписанием/записями —
это SoT `online-zapis-tv` через Internal Bot API.

## Фактический статус (`bot-TV`, соседний репозиторий)

| Элемент | Статус |
| --- | --- |
| Fail-closed baseline, `BOT_MODE=OFF`, emergency lock | `DONE` / verified — `AUDIT-BOT-01` OWNER PASS (`main`@`ed1abcc`) |
| Outbound / AI / каналы | Baseline: outbound automatic всегда `false`; AI provider enum отсутствует; live channels off — verified `AUDIT-BOT-01` |
| Собственные PostgreSQL + inbox/outbox / durable ingress / lease-retry | `DONE` — `BOT-CORE-FOUNDATION-01` (OWNER: **PG-only**; Redis **не** runtime-зависимость foundation) |
| Закрытый тестовый адаптер | `NOT DONE` → `BOT-CLOSED-TEST-01` (ещё зависит от `CONTRACT-MODE-01`) |
| Production channel adapters | `NOT DONE` |

### Storage foundation (канон)

Bot Core хранит диалоговое состояние и очереди в **собственном PostgreSQL**.
Redis **не** является обязательной частью foundation: не добавлять только ради
формального чекбокса. Если позже понадобится (например, отдельный nonce/cache
store), это отдельное OWNER-решение с обоснованием runtime-необходимости.

### Обязательный следующий security gap (не часть foundation)

**M1:** worker S2S **read** (eligibility / availability) сейчас может выполняться
без gate `BOT_MODE` / `EMERGENCY_LOCK`. Fail-closed hardening этого пути —
обязательный следующий шаг вместе с `CONTRACT-MODE-01` (до closed test / write).

## База знаний

Структурированная база знаний **может** содержать:

- статьи;
- документы;
- FAQ;
- показания и противопоказания;
- ощущения;
- рекомендации;
- правила записи (процедурные, не цены/слоты);
- акции (описательные; актуальные цены — из Booking SoT);
- регламент общения;
- версии;
- публикацию и откат;
- журнал изменений;
- source trace.

**Не копируются** в независимый источник истины:

- цены;
- длительности;
- услуги (как операционный каталог);
- мастера;
- расписание.

Они запрашиваются у `online-zapis-tv` через Internal Bot API.

| Элемент | Статус |
| --- | --- |
| KB schema / admin / publish-rollback | `NOT DONE` → `KNOWLEDGE-01` |
| Запрет дублирования SoT цен/слотов | `DONE` (политика) |
