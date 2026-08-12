# 07 — Интеграции и порядок rollout

## Порядок каналов (канон)

1. внутренний synthetic-тест;
2. закрытая тестовая поверхность;
3. amoCRM;
4. VK TEST по allowlist;
5. VK production;
6. MAX;
7. публичный чат сайта;
8. Telegram;
9. WhatsApp последним.

**Закрытый тест — до VK production.**
VK production не включать до прохождения synthetic → closed test → amoCRM → VK TEST allowlist и соответствующих OWNER gates.

## Control plane vs канон

В `docs/architecture/bot-control-plane-foundation.md` порядок начинается с внутренних API-контрактов, затем amoCRM → VK → MAX → сайт → Telegram → WhatsApp (без synthetic/closed test и без отдельного VK TEST allowlist).
Канон экосистемы **добавляет обязательные** synthetic и закрытый тест **перед** любым клиентским production-каналом и явно ставит VK TEST allowlist перед VK production.

Расхождение зафиксировано; код/порядок каналов в foundation в рамках DOCS-01 **не меняется** (канальные задачи backlog, не `CONTRACT-MODE-01`).

## Запись через диалог

Write-сценарий записи через бота включается только после выполнения всех требований
[04-internal-bot-api.md](./04-internal-bot-api.md) и production gate из
[03-runtime-modes-and-gates.md](./03-runtime-modes-and-gates.md).

## Backlog порядок (фрагмент)

- `AMO-01` — **следующий** canonical channel/integration gate после `BOT-CLOSED-TEST-01`
- `CHANNEL-VK-TEST-01`
- далее: VK production, MAX, site chat, Telegram, WhatsApp
- AI text (`AI-TEXT-01`) — после повторной проверки тарифов Яндекс AI, при provider ≠ `NONE` только с OWNER

## Статус интеграций

| Канал / интеграция | Статус |
| --- | --- |
| Synthetic / closed test adapter | `DONE` — `BOT-CLOSED-TEST-01` (bot-TV PR #33 `main`@`d055231`; admin PR #40 `main`@`1887e06`; CI green). Код в Git; **deploy/live production не утверждается** |
| amoCRM bot channel | `NOT DONE` → следующий gate `AMO-01` |
| VK TEST allowlist | `NOT DONE` |
| VK / MAX / site / Telegram / WhatsApp production | `NOT DONE` |
| Booking notifications (не AI Bot Core) | см. отдельный architecture doc; не путать с Bot Core |
