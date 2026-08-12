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
| Mode contract + M1 live S2S read gate | `DONE` — `CONTRACT-MODE-01` + M1 (`main`@`03ed268`, PR #32) |
| Закрытый тестовый адаптер | `NOT DONE` → следующий Bot Core gate `BOT-CLOSED-TEST-01` (`CONTRACT-MODE-01` dependency удовлетворена; closed test ещё не реализован) |
| Production channel adapters | `NOT DONE` |

### Storage foundation (канон)

Bot Core хранит диалоговое состояние и очереди в **собственном PostgreSQL**.
Redis **не** является обязательной частью foundation: не добавлять только ради
формального чекбокса. Если позже понадобится (например, отдельный nonce/cache
store), это отдельное OWNER-решение с обоснованием runtime-необходимости.

### M1 live S2S read gate (`DONE`)

Worker / composition live Booking Service **reads** (eligibility / availability)
gated by `BOT_MODE` + `EMERGENCY_LOCK`:

- `OFF` / `HINTS` / `DRAFT` → DENY live eligibility/availability;
- `AUTO_READ` / `AUTO_WRITE` → ALLOW только при `EMERGENCY_LOCK=false`;
- `EMERGENCY_LOCK=true` → absolute DENY в любом режиме;
- factory fail-closed (live-read clients не строятся при DENY);
- HTTP boundary re-check `is_live_booking_s2s_read_allowed(Settings)` непосредственно перед I/O;
- injected production HTTP clients/flows rebind к runtime Settings на composition roots;
- caller-controlled permission flag (`live_read_enabled` и аналоги) отсутствует;
- booking **write** и public/channel **outbound** этой задачей **не** включены.

Evidence: `bot-TV` `main`@`03ed268`, PR #32, `app/core/mode_contract.py`;
adversarial re-review APPROVE; GitHub PR Gate SUCCESS.

Closed test больше **не** ждёт незакрытый `CONTRACT-MODE-01`.
Следующий Bot Core gate: `BOT-CLOSED-TEST-01`.

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
