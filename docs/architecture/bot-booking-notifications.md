# Бот уведомлений о записи (MAX + SMS + VK)

Дата фиксации аудита и ТЗ: 2026-07-18  
Статус: **архитектурно-продуктовое ТЗ** (код runtime бота / worker / adapters / webhooks / миграции / UI **не** реализуется этим документом).

## Назначение и границы

Документ описывает будущую **транзакционную** доставку сервисных сообщений о записи (подтверждение, перенос, отмена, напоминание) с кнопкой управления через уже существующую веб-страницу `/booking/manage`.

Связанные foundation-документы (не дублировать их scope):

- [Bot control plane foundation](./bot-control-plane-foundation.md) — control plane `/admin/bot`, граница с AI Bot Core.
- [Communications foundation](./communications-foundation.md) — аудитория и черновики **рекламных** рассылок VK.
- [Communications composer](./communications-composer.md) — редактор медиа для рассылок.

**Разделение scope:** этот документ — transactional booking notifications. Communications foundation — marketing broadcasts. Binding MAX/SMS/VK для подтверждения записи **не** создаёт marketing consent.

**Приоритет каналов (владелец, booking notifications MVP):**

1. **MAX** — основной мессенджер.
2. **SMS** — обязательный автоматический fallback по номеру телефона.
3. **VK** — желательный дополнительный канал.
4. **Telegram / WhatsApp** — второстепенные будущие adapters; **не** основа MVP и не launch-blocker для MAX+SMS.

> Примечание: порядок каналов в [bot-control-plane-foundation](./bot-control-plane-foundation.md) относится к AI Bot Core / control plane и **не** отменяет приоритет MAX→SMS→VK для сервисных уведомлений о записи.

---

## Часть 1. Фактический аудит manage-link

Источники: `prisma/schema.prisma`, `src/services/BookingManageService.ts`, `src/services/AppointmentService.ts`, `src/app/api/booking/create/route.ts`, `src/app/booking/manage/*`, `src/app/api/booking/manage/*`, `src/components/booking/booking-success-screen.tsx`, `src/components/booking/booking-wizard.tsx`, `src/lib/schedule/appointment-contract.ts`, `src/lib/security/csrf-route-rules.ts`, `src/middleware.ts`, связанные security-скрипты/тесты.

### Реализовано сейчас

| # | Вопрос | Факт по коду |
|---|---|---|
| 1 | Создание `manageToken` | `createManageToken()` в `BookingManageService` (`randomBytes(32).toString("base64url")`). Вызывается в `AppointmentService.createAppointmentRecord` **только** при `source === "ONLINE"`. |
| 2 | Хранение | Поле `Appointment.manageToken` (`String? @unique`) — **открытый текст** в PostgreSQL. Hash/pepper нет. Миграция `prisma/migrations/20250705180000_appointment_manage_token/`. |
| 3 | Public URL | `buildManageUrl(token)` → относительный `/booking/manage?token=…` (`encodeURIComponent`). Origin не добавляется. Клиенту отдаётся в `POST /api/booking/create` как `manageUrl`. |
| 4 | Поверхности | Страница `src/app/booking/manage/page.tsx` + `BookingManageClient`. GET ` /api/booking/manage` (просмотр). POST `/api/booking/manage/cancel` (отмена). POST `/api/booking/manage/reschedule-request` (**заявка** на перенос, не автосмена слота). |
| 5 | После закрытия success | Да: токен в БД, URL самодостаточный. Success держит `manageUrl` только в React state (`booking-wizard` → `booking-success-screen`). |
| 6 | Повторное использование | Да: многократный GET; cancel при уже `CANCELLED`/`RESCHEDULED` идемпотентен (`alreadyCancelled`); повторный reschedule-request при `RESCHEDULED` разрешён. |
| 7 | Срок действия | **Нет** TTL/expiry-поля. Живёт, пока запись и токен в БД. |
| 8 | После событий | Перенос (клиент): `status → RESCHEDULED`, токен **не** меняется. Отмена (клиент/менеджер soft-cancel): токен остаётся. Hard delete записи нет. «Completed» в public view = `endsAt < now`. Архив клиента (`archiveClientForAdmin`) не трогает appointments/`manageToken`. |
| 9 | Ротация после переноса | **Нет** — `requestRescheduleByManageToken` не обновляет `manageToken`. |
| 10 | Повторные мутации | Cancel уже отменённой/с запросом переноса: OK (`alreadyCancelled`). Reschedule отменённой: 400. Reschedule после `RESCHEDULED`: разрешён. |
| 11 | Status/time checks | `canCancel` / `canRequestReschedule` / `resolvePublicStatus` в `BookingManageService`: нельзя отменить прошедшую; cancel только `SCHEDULED\|CONFIRMED` и public `active`. |
| 12 | Rate / CSRF / idempotency | Manage routes в `PUBLIC_MUTATING_API_PATHS` — **без** admin CSRF. Отдельного same-origin / rate limit на manage **нет**. Soft-idempotency cancel по статусу есть; idempotency-key API нет. |
| 13 | Утечки канала | Structured redact: ключи `token`/`manageToken` → `[REDACTED]` (security-batch2a). **Риск:** query `?token=` в access logs / history / Referer. `/booking/manage` **не** получает `Referrer-Policy: no-referrer` в `middleware` (в отличие от `/view/schedule`, `/reset-password`). Analytics для manage в репо не найдены. `LegalAcceptanceRecord.requestReference` = plaintext `manageToken`. Schedule/MASTER DTO **без** `manageToken` (`appointment-contract`). `AppointmentDto.mapAppointment` **включает** `manageToken` в ответы internal write API. |
| 14 | Роли | Клиент ONLINE: `manageUrl` после create + CTA на success. Любой носитель URL. OWNER/MANAGER schedule UI URL не строит. Write API AppointmentDto может вернуть `manageToken`. MASTER/view — запрещено контрактом + `tests/security-batch1.spec.ts`. |
| 15 | ПД в URL | Нет: только непрозрачный 32-byte base64url. Без `appointmentId`/телефона/имени. |
| 16 | Ротация/отзыв | Механизма regenerate/revoke/nullify **нет**. |
| 17 | Новая ссылка менеджером | Продуктового действия **нет**. |
| 18 | Автотесты | Частично: security-batch1 (нет manageToken у MASTER/view), security-batch2a (redact), role-access (public manage routes), reschedule-request check. **Нет** полного e2e create→manage→cancel/reschedule, expiry, rotation, rate limit. |
| 19 | Success UI | `booking-success-screen`: primary Link «Отменить или перенести запись» → `manageUrl`. |
| 20 | Persist у клиента | После закрытия success — **только** если URL в history браузера / закладках. Server-side: `appointments.manage_token` (+ копия в legal acceptance `request_reference`). Email/SMS/localStorage **нет**. |

Дополнительно по домену ONLINE-записи:

- Онлайн-запись создаётся со `status: "SCHEDULED"`; public note: «ожидает подтверждения менеджером» (`resolveConfirmationNote`), пока не `CONFIRMED`.
- «Перенос» по manage-link = заявка менеджеру (`BookingRequest` типа `RESCHEDULE_REQUEST`), не мгновенная смена слота в расписании.

### Ограничения текущей реализации

- Нет доставки manage URL вне success-экрана (бот/SMS отсутствуют) → клиент легко теряет ссылку.
- Bearer-токен в query string → риск логов прокси, Referer, browser history.
- Plaintext в БД и дублирование в `requestReference`.
- Нет expiry / rotation / manager reissue.
- Нет rate limiting и same-origin защиты на manage mutations.
- Internal `AppointmentDto` может отдавать `manageToken` OWNER/MANAGER API.
- Public «completed» завязан на `endsAt`, не на enum `COMPLETED`/`NO_SHOW`.

### Требуется до подключения бота

Минимальный hardening manage-link (можно частично параллельно с foundation доставки):

1. `Referrer-Policy: no-referrer` (+ по возможности `Cache-Control: no-store`) для `/booking/manage` и manage API.
2. Rate limiting на GET/POST manage.
3. Same-origin (или эквивалент) для manage mutations.
4. Политика: не писать полный manage URL / raw token в application logs и audit (legal `requestReference` — заменить на несекретный reference id).
5. Убрать `manageToken` из штатных schedule/list DTO; для staff — отдельное явное действие «выдать/ротировать ссылку» с audit без секрета.
6. Ротация/отзыв токена при утечке; решение по TTL (см. Open decisions).
7. Automated tests manage-flow + запрет утечки токена.
8. Абсолютный HTTPS manage URL (или внутренний short redirect) для вставки в MAX/SMS/VK — строить на сервере из канонического origin, **не** через сторонний публичный URL-shortener с секретом в path.

Бот **не** дублирует бизнес-логику расписания: отмена/перенос остаются на существующей веб-странице.

---

## Часть 2. Целевая клиентская логика (без ручной работы менеджера)

1. Клиент оформляет запись на сайте.
2. Сервис атомарно сохраняет запись и доменное событие доставки (outbox) в одной транзакции с записью.
3. Worker доставляет сообщение:
   - **MAX**, если клиент привязал MAX;
   - иначе **SMS** на обязательный телефон формы;
   - **VK**, если клиент явно выбрал и привязал VK (дополнительно к политике fallback — см. Open decisions).
4. Сообщение содержит: название студии, процедуру, мастера, дату/время, статус, одну кнопку/ссылку **«Перенести или отменить запись»** → manage URL (или внутренний short redirect на manage URL).
5. Сообщение остаётся в переписке клиента — ссылку не нужно вручную копировать с success-страницы.
6. Перенос и отмена выполняются на существующей защищённой веб-странице manage; бот не реализует слоты/конфликты.
7. После переноса/отмены (и изменений студией) система шлёт обновлённое сервисное сообщение.
8. Позже — напоминание с той же кнопкой управления.

Success-страница может дополнительно показывать кнопку «Получить подтверждение в MAX» (binding), но **не** обязана требовать ручного сохранения ссылки.

---

## Часть 3. Идентификация каналов

### Ограничения

- Форма онлайн-записи **обязательно** собирает телефон → достаточно для SMS.
- По номеру телефона **нельзя** безопасно и автоматически найти аккаунт MAX или VK.
- Для MAX/VK нужна **однократная явная привязка** пользователя к боту/сообществу.
- Универсальный поиск аккаунтов мессенджеров по телефону **запрещён** в дизайне.

### MAX (основной)

- После успешной записи — заметная CTA «Получить подтверждение в MAX».
- Клиент один раз запускает бота по deep link с **короткоживущим одноразовым непрозрачным binding token** (не равен `manageToken`, без ПД).
- Webhook получает событие запуска (`bot_started` / актуальный Update) и `channelUserId`/`chatId`.
- Backend связывает канал с клиентом и/или записью после проверки binding token.
- Бот сразу отправляет подтверждение записи с manage-кнопкой.
- Последующие сервисные сообщения — автоматически на привязанный канал.
- Официальные источники: [MAX Bot API](https://dev.max.ru/docs-api), [prepare / production webhook](https://dev.max.ru/docs/chatbots/bots-coding/prepare), [Update / bot_started](https://dev.max.ru/docs-api/objects/Update).

### SMS (обязательный fallback)

- Если MAX/VK не привязан, binding не завершён, или доставка в мессенджер failed/timeout → SMS на телефон записи.
- Провайдер **ещё не выбран** (Open decisions).
- Учитывать лимит длины, стоимость, rate limits.
- Короткая ссылка: **свой** домен / внутренний redirect token (`CommunicationRedirectToken`-подобный паттерн или отдельный booking redirect) — **не** отдавать секретный manage token стороннему публичному сокращателю.

### VK (дополнительный)

- Явная привязка к сообществу/боту; без поиска по телефону.
- Binding flow по смыслу как у MAX, с учётом актуального официального VK API на этапе интеграции.
- Конкретные endpoint’ы и форматы **не** фиксируются в этом ТЗ до проверки актуальной документации VK.

### Telegram / WhatsApp (будущее)

- Только возможные adapters; **не** в launch readiness MVP.
- Отсутствие не блокирует MAX+SMS.
- Справочно: [Telegram Bot Features](https://core.telegram.org/bots/features), [WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform).
- Не строить общую архитектуру вокруг их доступности/VPN.

---

## Часть 4. Архитектура доставки (transactional outbox)

### Принципы

- Создание/изменение записи и запись outbox-события — **атомарно** в одной DB-транзакции.
- Внешний провайдер **не** вызывается внутри транзакции записи.
- Worker читает outbox и вызывает adapter канала.
- Один adapter на канал (MAX / SMS / VK / future).
- Retry с backoff; `idempotencyKey`; `providerMessageId`; `deliveryStatus`; `attemptCount`; `nextAttemptAt`; `deliveredAt` / `failedAt`.
- Dead-letter + manual retry; сбой провайдера **не** отменяет и не откатывает запись.
- Исключение дублей: уникальность idempotency key на (event, channel, recipient) / эквивалент.

### События (имена можно адаптировать к словарю домена)

| Событие | Смысл |
|---|---|
| `BOOKING_RECEIVED` | Онлайн-заявка/запись принята системой (если первое сообщение до staff confirm). |
| `APPOINTMENT_CONFIRMED` | Запись подтверждена (если confirm — отдельный шаг). |
| `APPOINTMENT_RESCHEDULED` | Перенос выполнен или принят (уточнить: заявка vs фактическая смена слота). |
| `APPOINTMENT_CANCELLED` | Отмена. |
| `APPOINTMENT_CHANGED_BY_STAFF` | Изменение студией (мастер/время/услуга). |
| `APPOINTMENT_REMINDER_DUE` | Напоминание по расписанию. |

### Feature flags

Все каналы **выключены по умолчанию** до готовности credentials и юридических формулировок.

---

## Часть 5. Привязка клиента к каналу (модель, без миграции сейчас)

Логическая модель (имена таблиц — ориентир):

**ChannelBinding / ClientChannelIdentity**

- связь с `Client` и/или нормализованным телефоном записи;
- `channel` (`MAX` \| `SMS` \| `VK` \| future);
- `channelUserId` / `chatId`;
- `normalizedPhone` (для SMS и корреляции, не для поиска чужих аккаунтов);
- `verifiedAt`;
- `bindingSource` (deep_link_booking_success, staff, import — явно);
- `serviceNotificationsEnabled`;
- `stopped` / `revoked` (+ причина);
- `lastDeliveryAt`.

**BindingToken**

- криптографически случайный;
- одноразовый;
- короткоживущий;
- хранится **только hash**;
- ≠ `manageToken`;
- не содержит `appointmentId`, телефон, ПД;
- не логируется целиком;
- `expiresAt`, `usedAt`; инвалидация после use/expiry.

Запрещено связывать канал с клиентом только по совпадению имени или непроверенного номера из профиля мессенджера.

---

## Часть 6. Целевая политика безопасности manage URL

| Требование | Статус относительно аудита |
|---|---|
| Bearer-ссылка с высокой энтропией | **Уже есть** (`randomBytes(32)` base64url). |
| Нет ПД / предсказуемых id в URL | **Уже есть**. |
| Запрет обычного логирования полного URL/токена | Частично (redact ключей); усилить access logs / legal reference. |
| `Referrer-Policy: no-referrer` на manage | **Нужно добавить**. |
| `Cache-Control: no-store` на чувствительные manage ответы | **Рассмотреть / добавить**. |
| Status/time checks | **Уже есть** (доработать под enum COMPLETED/NO_SHOW при необходимости). |
| Ротация при утечке + отзыв старого | **Нужно**. |
| TTL токена | Open decision. |
| Поведение после отмены/завершения | Сейчас: просмотр возможен, мутации ограничены; зафиксировать продуктовую политику (Open decisions). |
| Защита от повторной мутации | Частично (cancel soft-idempotent; cancel past blocked). |
| Rate limiting | **Нужно**. |
| Audit trail без секрета | **Нужно** (сейчас `requestReference` = token). |
| Тесты на утечку и reuse | Частично → расширить. |
| Manager reissue | **Нужно** для безопасного ответа на утечку. |

Бот передаёт ту же manage-ссылку (или short redirect на неё); не создаёт второй секретный механизм управления слотами.

---

## Часть 7. Сервисные сообщения vs реклама

### Сервисные (этот ТЗ)

- подтверждение / получение записи;
- перенос;
- отмена;
- изменение студией;
- напоминание о визите.

### Рекламные (Communications foundation)

- акции, рассылки, реактивация, маркетинговые предложения.

### Согласия

Выбор MAX/SMS/VK для подтверждения записи:

- **не** означает согласие на рекламу;
- **не** создаёт marketing consent;
- **не** включает рекламные сообщения.

Marketing consent хранится и проверяется отдельно (см. communications foundation: `consentStatus`, suppression, `deliveryStatus`).

---

## Часть 8. Этапы реализации

### Этап 0 — решения и внешняя подготовка

- Зарегистрировать/подтвердить организацию и бота MAX.
- Выбрать SMS-провайдера.
- Определить готовность VK community/bot.
- Credentials только вне Git.
- Юридические формулировки сервисных уведомлений.

### Этап 1 — foundation

- Outbox + delivery attempts.
- Adapters interface.
- Binding tokens (hash).
- Webhook security (signature, replay).
- Feature flags; каналы **off** by default.

### Этап 2 — MAX

- Deep-link binding.
- Webhook.
- Подтверждение + manage button.
- Retry/idempotency.
- Stop/revoke handling.

### Этап 3 — SMS fallback

- Автоfallback.
- Собственная короткая ссылка / redirect.
- Delivery receipts (если доступны).
- Стоимость и rate limits.

### Этап 4 — VK

- Binding + adapter + callback.
- Сервисные сообщения.
- Детали API — по актуальной документации на интеграции.

### Этап 5 — полный жизненный цикл

- События переноса/отмены/staff change.
- Напоминания.
- Monitoring + manual retry.

---

## Часть 9. Open decisions

| # | Решение | Зачем нужно до кодирования |
|---|---|---|
| 1 | Первое сообщение: сразу после ONLINE create (`SCHEDULED`) или только после `CONFIRMED`? | Сейчас UI говорит «ожидает подтверждения менеджером». |
| 2 | Является ли онлайн-запись сразу «подтверждённой» для клиента? | Влияет на текст и событие `BOOKING_RECEIVED` vs `APPOINTMENT_CONFIRMED`. |
| 3 | TTL `manageToken` | Сейчас бессрочный. |
| 4 | Ротация `manageToken` после переноса / staff change? | Сейчас не ротируется. |
| 5 | Поведение ссылки после отмены и после завершения | Просмотр vs полный revoke. |
| 6 | TTL binding token | Безопасность deep link. |
| 7 | Срок хранения delivery attempts / provider logs | GDPR/хранилище/стоимость. |
| 8 | Время напоминания (например −24h / −2h) | Продукт. |
| 9 | SMS-провайдер | Этап 3. |
| 10 | Лимит стоимости SMS / caps | Бюджет. |
| 11 | Формат собственного short URL | Path shape, TTL redirect token. |
| 12 | MAX registration/moderation readiness | Этап 0. |
| 13 | VK community/bot readiness | Этап 0/4. |
| 14 | Обязателен ли выбор канала на success или только CTA MAX? | UX. |
| 15 | Fallback, если все каналы недоступны | UI + manual staff contact. |
| 16 | Отправлять ли SMS всегда как parallel guarantee или только fallback? | Стоимость vs надёжность. |
| 17 | Клиентский «перенос» остаётся заявкой или появится self-serve слот? | События и тексты бота. |

---

## Часть 10. Обязательные automated tests (будущая реализация)

- Outbox создаётся атомарно с appointment write.
- Повтор worker не дублирует сообщение (idempotency).
- Retry/backoff соблюдаются; DLQ reachable.
- Provider failure не отменяет запись.
- Binding token: one-time + expiry; чужой token не связывает.
- Webhook: signature + replay protection.
- Токены (manage/binding) отсутствуют в application logs / audit payloads.
- MAX success → SMS fallback **не** уходит (если политика = fallback-only).
- MAX failure/timeout → SMS уходит.
- Service message **не** требует marketing consent.
- Marketing message без consent запрещён.
- Перенос/отмена порождают корректные outbox-события.
- Отменённую запись нельзя мутировать повторно (кроме идемпотентного cancel).
- Старые записи без channel binding продолжают работать (SMS / manage web).
- Роли не получают лишний доступ к raw manage token (schedule/MASTER/view).

---

## Часть 11. Официальные ссылки

- MAX Bot API: https://dev.max.ru/docs-api
- MAX production webhook / prepare: https://dev.max.ru/docs/chatbots/bots-coding/prepare
- MAX Update / bot_started: https://dev.max.ru/docs-api/objects/Update
- Telegram (future): https://core.telegram.org/bots/features
- WhatsApp Business Platform (future): https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform

VK: endpoint’ы и схемы подтверждать по актуальной официальной документации на этапе интеграции; в этом ТЗ не фиксируются.

---

## Часть 12. Связи в репозитории

| Документ | Связь |
|---|---|
| [bot-control-plane-foundation.md](./bot-control-plane-foundation.md) | Control plane vs AI Bot Core; этот файл — transactional booking notifications. |
| [communications-foundation.md](./communications-foundation.md) | Marketing ≠ service notifications. |
| [communications-composer.md](./communications-composer.md) | Редактор рекламных кампаний; не manage-link. |

Operational runbooks (`docs/operations/*`) этим ТЗ не расширяются: runtime бота ещё нет.
