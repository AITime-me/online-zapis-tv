# Communications composer (редактор рассылок)

Дата: 2026-07-16

## Решение по изображениям

В проекте нет устойчивого object storage для медиа (есть только локальный volume аварийных выгрузок).

Для MVP изображения черновиков хранятся в PostgreSQL (`CommunicationMediaAsset.data` BYTEA):

- исходный лимит загрузки 5 МБ;
- после перекодирования через `sharp` (без EXIF) — жёсткий лимит хранения ~1.5 МБ;
- лимит числа ассетов (200);
- доступ только OWNER через `/api/admin/communications/media`.

Это переживает deploy вместе с БД и попадает в `pg_dump`. Не допускайте неограниченного роста: удаляйте неиспользуемые ассеты.

При появлении S3/object storage миграция должна вынести бинари из Postgres.

## Provider boundary

`CommunicationDeliveryProvider` + текущая реализация `DisabledCommunicationDeliveryProvider`:

- без network calls;
- всегда `VK_CONNECTOR_NOT_READY`;
- UI/API не зависят от VK SDK.

## Что блокируется до VK

- тестовая отправка;
- SCHEDULED / RUNNING;
- кнопка «Запустить рассылку».

Разрешено: черновик, предпросмотр, проверка, READY (без отправки).
