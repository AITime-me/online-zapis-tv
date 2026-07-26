# 01 — Границы системы и владение данными

## Каноническое решение

`online-zapis-tv` — **единственный источник истины** для:

- услуг;
- цен;
- длительности;
- мастеров;
- расписания;
- клиентов;
- записей (appointments);
- правил конфликтов слотов.

Bot Core (`bot-TV`) и n8n **не получают прямого доступа** к PostgreSQL `online-zapis-tv`.

Доступ Bot Core к основному сервису возможен **только** через версионированный **Internal Bot API** с service-to-service authentication.

## Роли контуров

| Контур | Владеет | Не владеет |
| --- | --- | --- |
| Booking Service (`online-zapis-tv`) | Каталог, слоты, клиенты, записи, конфликты, transactional integrity записи | Диалоговым состоянием каналов, AI-маршрутизацией |
| Bot Control Plane (`/admin/bot` в `online-zapis-tv`) | BotSettings, readiness, policy gates UI, audit bot settings | Runtime диалогов, очередями сообщений |
| Bot Core (`bot-TV`) | Входящие события, диалоговое состояние, очереди, AI-маршрутизация, handoff, защита от двойных ответов, inbox/outbox своего контура, retry, reconciliation | Прямым SQL к booking DB; самостоятельным изменением каталога/цен/расписания |
| n8n | Фоновая оркестрация technical workflows | Обязательным звеном клиентских сообщений; ПДн клиентов; критическими командами расписания |

## Фактический статус (Git)

| Элемент | Статус | Доказательство |
| --- | --- | --- |
| Booking SoT (услуги/мастера/слоты/записи) | `DONE` | Prisma + public booking API |
| Control plane BotSettings / readiness | `PARTIAL` | `src/lib/bot-settings/*`, `/admin/bot`, миграции |
| Internal Bot API (версионированный S2S) | `NOT DONE` | Нет `src/app/api/internal/bot/**` |
| Запрет прямого доступа Bot Core/n8n к booking PG | `DONE` (политика) / `NOT VERIFIED` (runtime) | Канон в этом документе; runtime/server evidence в этой задаче не снимался |
| Bot Core baseline fail-closed | `NOT VERIFIED` | Sibling `bot-TV`; закрепляет `AUDIT-BOT-01` |

## Запрет прямого доступа к БД

Любой путь вида:

- shared DB credentials для Bot Core / n8n;
- прямые SQL/Prisma из бота к booking Postgres;
- копирование цен/слотов в независимый «второй источник истины»

— **запрещён**. Единственный канал чтения/записи booking-данных для бота — Internal Bot API.
