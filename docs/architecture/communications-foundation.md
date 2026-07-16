# Communications foundation (VK broadcasts control plane)

Дата фиксации: 2026-07-16

## Граница этапа

`online-zapis-tv` хранит аудиторию коммуникаций и черновики рассылок.

На этом этапе:

- нет VK API calls;
- нет webhook;
- нет worker/queue реальной отправки;
- нет токенов VK в БД;
- SaleBot используется только как ручной источник импорта CSV/ZIP;
- `Client` не создаётся автоматически из импорта;
- Bot Foundation (`/admin/bot`) не смешивается с рассылками.

## Сущности

- `CommunicationContact` — отдельная аудитория канала (не CRM);
- `CommunicationSuppression` — реестр запретов сильнее повторного импорта;
- `CommunicationSegment` — определения фильтров;
- `CommunicationCampaign` + buttons — черновики DRAFT/READY;
- `CommunicationImportJob` — журнал без исходного файла;
- `CommunicationEvent` — события аналитики (foundation);
- `CommunicationRedirectToken` — непрозрачные CTA redirect;
- `CommunicationSettings` — singleton без токенов.

## Допуск к рекламной рассылке

Только `deliveryStatus=ALLOWED` + `consentStatus=CONFIRMED` + нет отписки + нет suppression.

`UNKNOWN` согласие не допускается.

## Следующий этап

1. VK connector (секреты вне БД, readiness);
2. Callback webhook входящих сообщений → auto-add contacts;
3. Worker/queue отправки с идемпотентностью и audit;
4. Реальные `ACCEPTED_BY_CHANNEL` / `READ_CONFIRMED` события.
