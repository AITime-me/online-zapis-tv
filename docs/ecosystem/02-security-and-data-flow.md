# 02 — Безопасность и потоки данных

## Принципы

1. Booking Service хранит персональные данные клиентов и записи.
2. Bot Core обрабатывает тексты диалогов в своём контуре (собственные PostgreSQL/Redis — после foundation).
3. n8n получает **только безопасные технические данные**.
4. Секреты не попадают в логи, backup manifests без необходимости, n8n payloads и chat alerts.

## Запрещено передавать через n8n

- телефоны клиентов;
- исходные тексты клиентских сообщений;
- фотографии;
- ключи и токены;
- критические команды изменения расписания.

## Допустимые технические данные для n8n / Error Handler

Примеры: workflow id/name, execution id, node name, error type/code, timestamp, retry count, correlation id без ПДн.

## Потоки (целевые)

```text
Клиентский канал
  → Bot Core (ingress / state / AI / guards)
  → Internal Bot API (S2S + HMAC + nonce + idempotency)
  → Booking Service (SoT)
  → transactional outbox / ответы по политике режима
```

n8n **не** стоит в обязательном пути клиентского сообщения.

## AI provider

В Booking control plane default AI provider — `NONE`
(`prisma/migrations/20260725210000_bot_settings_provider_default_none`,
`DEFAULT_BOT_SETTINGS.provider` в `src/lib/bot-settings/defaults.ts`).

В Bot Core baseline (`bot-TV`) отдельного AI-provider enum пока нет: AI/каналы
не подключены, для `OFF` токены AI не требуются, автоматический outbound
запрещён кодом. Это **не** тождественно полю `provider=NONE` control plane;
статус AI в `bot-TV` закрепляет `AUDIT-BOT-01`.

## Фактический статус

| Контроль | Статус |
| --- | --- |
| Default `NONE` в BotSettings | `DONE` (миграция + код defaults) |
| S2S auth / HMAC / nonce / replay для Internal Bot API | `NOT DONE` |
| Запрет ПДн в n8n | `DONE` (политика) / runtime `NOT DONE` (n8n не развёрнут) |
| Секреты не в Git | `PARTIAL` — политика есть; server log evidence → `AUDIT-OPS-02` |
