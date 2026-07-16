# Bot control plane foundation

Дата фиксации: 2026-07-16

## Граница проектов

`online-zapis-tv` — Booking Service и control plane (`/admin/bot`).

**AI Bot Core** — отдельный runtime (отдельный deploy boundary). Сейчас не развёрнут и не реализуется внутри Next.js.

Взаимодействие в будущем: только ограниченные версионированные internal API + service-to-service auth, idempotency, audit. Прямой доступ Bot Core к PostgreSQL `online-zapis-tv` запрещён.

Не создаём: второй каталог, второе расписание, копию Booking Service, runtime LLM/каналов/очереди в Next.js.

## Канонический порядок подключения

0. Внутренние API-контракты  
1. amoCRM  
2. VK  
3. MAX (актуальная официальная документация; не хардкодить устаревший `platform-api.max.ru`)  
4. Сайт (чат-виджет)  
5. Telegram  
6. WhatsApp (future enum, без runtime на foundation)

## Целевой AI

Yandex Cloud AI Studio: классификатор + диалоговая модель FSM.  
`BotSettings.provider` по умолчанию `NONE`. OpenAI — только возможный резерв.

## AUTO

Блокируется расширенными readiness-группами (architecture / AI / channel / amoCRM / booking / data_security), включая tone post-filter, temporary hold, amoCRM ownership и address completeness.
