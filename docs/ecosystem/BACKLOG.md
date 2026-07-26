# Единый backlog экосистемы «Твоё время»

Статусы: `DONE` | `PARTIAL` | `NOT DONE` | `NOT VERIFIED`.

Server-проверки **не** помечаются `DONE`, если сервер в этой задаче не проверялся.

| ID | Задача | Контур | Статус | Зависит от | Критерии готовности | Запрещено включать | Доказательство |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DOCS-01 | Канонические документы экосистемы и единый backlog | docs | DONE | — | Каталог `docs/ecosystem/*`, `docs/ops/AUDIT-OPS-02.md`, зафиксированы границы/modes/n8n/API/каналы; поиск ключевых терминов проходит; commit + принятие OWNER | Production, каналы, write, AI≠NONE | `docs/ecosystem/` (включая `BACKLOG.md`), `docs/ops/AUDIT-OPS-02.md`; документационный commit `docs(ecosystem): establish canonical architecture and backlog` |
| AUDIT-OPS-02 | Доказательная проверка ops-контура backup/restore/IHM | ops | NOT VERIFIED | DOCS-01 | Server evidence: timers, свежий dump, checksum/verify, isolated restore-test + возраст, IHM warning/critical/recovery, нет alert-spam, диски/mount, post-reboot, нет секретов/ПДн в логах | Закрытие без server evidence; изменение prod defaults | Карточка `docs/ops/AUDIT-OPS-02.md`; код ops в Git; server — отсутствует в этой задаче |
| AUDIT-BOT-01 | Свежий аудит `bot-TV` | bot-TV | NOT VERIFIED | DOCS-01 | Актуальный отчёт по fail-closed, modes, outbound, health, deps; статусы по коду | Включение каналов/AI/write | Требуется повторный read-only аудит репозитория `bot-TV` |
| AUDIT-API-01 | Аудит booking / Internal API и race-защиты | booking | NOT DONE | DOCS-01 | Карта публичного vs internal API; Serializable/static check vs live race; gaps S2S/HMAC/outbox | Write через бота | Public booking есть; Internal Bot API нет; race live test нет |
| CONTRACT-MODE-01 | Согласование runtime enums control plane ↔ Bot Core | contract | NOT DONE | DOCS-01, AUDIT-BOT-01 | Единый контракт или явный mapping `TEST`/`AUTO` ↔ `AUTO_READ`/`AUTO_WRITE` + exposure gates; OWNER approve | Тихий выбор enum в коде без решения | Расхождение задокументировано в `03-runtime-modes-and-gates.md` |
| BOT-API-READ-01 | Read-only Internal Bot API | booking+bot | NOT DONE | AUDIT-API-01, BOT-AUTH-01* | Версионированные read endpoints каталога/слотов без прямого PG; контракт стабилен | Write endpoints; публичная экспозиция | *auth может идти параллельно/чуть раньше по дизайну; без auth read не в prod |
| BOT-AUTH-01 | S2S auth, HMAC, timestamp, nonce, replay | booking+bot | NOT DONE | AUDIT-API-01 | Service identity, подпись, окно времени, nonce store, replay reject | Ослабление replay; shared DB creds | Код отсутствует |
| BOOKING-RACE-01 | Настоящий concurrent integration test одного слота | booking | NOT DONE | AUDIT-API-01 | Два одновременных запроса → один success, нет двойной записи | Объявление защиты DONE только по static check | Static `security-appointment-double-book-check.ts` = PARTIAL evidence only |
| N8N-DESIGN-01 | Compose, storage, backup и monitoring design для n8n | n8n/ops | NOT DONE | DOCS-01, AUDIT-OPS-02 | Design doc: диск, backup, mounts, внешний мониторинг; n8n не единственный watchdog | Установка без design; ПДн в n8n | Политика в `06-n8n-and-operations.md` |
| N8N-ERROR-01 | `SYSTEM — Error Handler` | n8n | NOT DONE | N8N-DESIGN-01 | Error Trigger первой нодой; Error Workflow на активных WF; limited retry; DLQ; warning/critical/recovery; внешний мониторинг; без автофикса записей | Infinite retry; автоправка клиентов/расписания | Требования в `06-n8n-and-operations.md` |
| N8N-STAGING-01 | Установка staging n8n в выключенном состоянии | n8n | NOT DONE | N8N-DESIGN-01, N8N-ERROR-01 | Staging up, workflows inactive/default off, Error Handler назначен | Production n8n; клиентский message path через n8n | — |
| BOT-CORE-FOUNDATION-01 | Собственные PostgreSQL/Redis/inbox/outbox Bot Core | bot-TV | NOT DONE | AUDIT-BOT-01 | Изолированное хранилище состояния/очередей; retry/reconciliation skeleton | Booking PG credentials; write booking | Baseline fail-closed ≠ foundation storage |
| BOT-CLOSED-TEST-01 | Закрытый тестовый адаптер / поверхность | bot-TV + admin | NOT DONE | BOT-CORE-FOUNDATION-01, CONTRACT-MODE-01 | Synthetic/closed test до публичных каналов; OWNER gate | VK production и далее | Порядок каналов в `07-integrations-and-rollout.md` |
| BOT-API-WRITE-01 | Write API записи через Internal Bot API | booking+bot | NOT DONE | BOT-API-READ-01, BOT-AUTH-01, BOOKING-RACE-01, BOT-CLOSED-TEST-01 | Полный write checklist из `04` + `08`; outbox; UNKNOWN reconciliation | `AUTO_WRITE` / production channel write до checklist | — |
| AMO-01 | Интеграция amoCRM | channels | NOT DONE | BOT-CLOSED-TEST-01 | amoCRM после closed test; fail-closed defaults | Обход порядка каналов | — |
| KNOWLEDGE-01 | База знаний (без копирования SoT цен/слотов) | knowledge | NOT DONE | DOCS-01 | Статьи/FAQ/версии/publish/rollback/source trace; цены/слоты только из Booking API | Второй SoT каталога | Политика в `05-bot-core-and-knowledge.md` |
| AI-TEXT-01 | Яндекс AI после повторной проверки тарифов | AI | NOT DONE | KNOWLEDGE-01, BOT-CLOSED-TEST-01, OWNER | Provider остаётся `NONE` до OWNER; тарифы перепроверены | Default AI≠NONE; prod auto-replies без gates | Default `NONE` в миграции BotSettings |
| CHANNEL-VK-TEST-01 | VK TEST по allowlist | channels | NOT DONE | AMO-01 | Allowlist only; до VK production | VK production | — |
| CHANNEL-VK-PROD-01 | VK production | channels | NOT DONE | CHANNEL-VK-TEST-01, production gate | OWNER + monitoring | До allowlist/test | — |
| CHANNEL-MAX-01 | MAX | channels | NOT DONE | CHANNEL-VK-PROD-01 | По канон-порядку | Раньше VK prod | — |
| CHANNEL-SITE-01 | Публичный чат сайта | channels | NOT DONE | CHANNEL-MAX-01 | По канон-порядку | — | — |
| CHANNEL-TG-01 | Telegram | channels | NOT DONE | CHANNEL-SITE-01 | По канон-порядку | — | — |
| CHANNEL-WA-01 | WhatsApp (последним) | channels | NOT DONE | CHANNEL-TG-01 | Последний канал | Любой earlier enable WA | — |
| PROD-ROLLOUT-01 | Production rollout gates (HINTS→…→AUTO_WRITE:booking) | rollout | NOT DONE | BOT-API-WRITE-01, AUDIT-OPS-02 DONE, канальные prerequisites | Каждый шаг — OWNER; checklist `08` | Автоматическое включение после dev | — |

\* `BOT-API-READ-01` и `BOT-AUTH-01` проектируются вместе; в prod read без auth запрещён.
